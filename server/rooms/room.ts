/**
 * A room: membership, lobby state, host management, chat, and the bridge to
 * the authoritative MatchSim. Rooms are transport-agnostic — outputs are
 * collected and handed to a RoomHost (WS runtime or SSE/Redis runtime).
 */
import * as C from '../../shared/constants';
import { MAP_IDS } from '../../shared/maps';
import type { MapId } from '../../shared/maps';
import type { GameEvent, MatchResult, RoomPhase, RoomState, ServerMsg, Snapshot, WeaponId } from '../../shared/types';
import { MatchSim } from '../game/sim';
import { makeRoomCode, validateCode } from '../validation';

export interface ServerConn {
  id: string;
  send(msg: ServerMsg): void;
  close(): void;
  roomId: string | null;
  playerId: string | null;
}

export interface RoomOutput {
  /** member id, or null for broadcast */
  to: string | null;
  msg: ServerMsg;
}

export interface RoomHost {
  now(): number;
  /** Deliver collected outputs (send to conns / publish to store). */
  deliver(code: string, out: RoomOutput[]): void;
  /** Called when the room becomes empty so the host can drop it. */
  onEmpty(code: string): void;
  /** Notify that lobby state changed (store sync). */
  onChanged(code: string): void;
}

export interface Member {
  id: string;
  name: string;
  token: string;
  ready: boolean;
  conns: Set<ServerConn>;
  /** member whose clients live on another instance (Redis mode) */
  remote: boolean;
  /** session id on the remote instance (Redis mode direct replies) */
  remoteSid: string | null;
  lastDisconnectAt: number;
}

function randId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room {
  code: string;
  mapId: MapId;
  sim: MatchSim;
  members = new Map<string, Member>();
  hostId: string;
  overAt = 0;
  lastActivity: number;
  winnerName: string | null = null;
  lastResults: MatchResult | null = null;
  /** most recent snapshot (with events) — used by the Redis-mode publisher */
  lastSnap: Snapshot | null = null;
  private host: RoomHost;
  pending: RoomOutput[] = [];
  private nextMemberId = 1;

  constructor(code: string, mapId: MapId, host: RoomHost, now: number) {
    this.code = code;
    this.mapId = mapId;
    this.sim = new MatchSim(mapId);
    this.host = host;
    this.lastActivity = now;
    this.hostId = '';
  }

  get phase(): RoomPhase {
    return this.sim.phase;
  }

  connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.conns.size > 0 || m.remote) n++;
    return n;
  }

  isFull(): boolean {
    return this.members.size >= C.MAX_PLAYERS;
  }

  // ── Membership ─────────────────────────────────────────────────────────

  addMember(name: string, opts: { remote?: boolean; remoteSid?: string | null } = {}): Member {
    const m: Member = {
      id: `p${this.nextMemberId++}`,
      name,
      token: makeToken(),
      ready: false,
      conns: new Set(),
      remote: opts.remote ?? false,
      remoteSid: opts.remoteSid ?? null,
      lastDisconnectAt: 0,
    };
    this.members.set(m.id, m);
    if (!this.hostId) this.hostId = m.id;
    // Sim players exist from the moment someone joins (startMatch resets them).
    this.sim.addPlayer(m.id, name, this.host.now());
    this.lastActivity = this.host.now();
    return m;
  }

  attachConn(memberId: string, conn: ServerConn): boolean {
    const m = this.members.get(memberId);
    if (!m) return false;
    m.conns.add(conn);
    conn.roomId = this.code;
    conn.playerId = memberId;
    m.lastDisconnectAt = 0;
    return true;
  }

  /** Attach a remote (cross-instance) member by session id (Redis mode). */
  attachRemote(memberId: string, remoteSid: string): Member | null {
    const m = this.members.get(memberId);
    if (!m) return null;
    m.remote = true;
    m.remoteSid = remoteSid;
    m.lastDisconnectAt = 0;
    return m;
  }

  remoteDisconnect(remoteSid: string): void {
    for (const m of this.members.values()) {
      if (m.remoteSid !== remoteSid) continue;
      if (this.phase === 'lobby') {
        this.removeMember(m.id, 'disconnected');
      } else {
        m.lastDisconnectAt = this.host.now();
        const sp = this.sim.players.get(m.id);
        if (sp) sp.connected = false;
        this.pending.push({ to: null, msg: { t: 'notice', msg: `${m.name} disconnected` } });
        this.push({ t: 'conn', i: m.id, on: false });
        this.broadcastRoom();
      }
      return;
    }
  }

  detachConn(conn: ServerConn): void {
    const m = conn.playerId ? this.members.get(conn.playerId) : undefined;
    conn.roomId = null;
    conn.playerId = null;
    if (!m) return;
    m.conns.delete(conn);
    if (m.conns.size === 0 && !m.remote) {
      m.lastDisconnectAt = this.host.now();
      if (this.phase === 'lobby') {
        this.removeMember(m.id, 'disconnected');
      } else {
        this.pending.push({ to: null, msg: { t: 'notice', msg: `${m.name} disconnected` } });
        this.push({ t: 'conn', i: m.id, on: false });
        this.broadcastRoom();
      }
    }
  }

  /** Reclaim a slot by token (reconnect). Returns member or null. */
  reclaimByToken(token: string, conn: ServerConn | null, remoteSid: string | null): Member | null {
    for (const m of this.members.values()) {
      if (m.token !== token) continue;
      if (conn) {
        this.attachConn(m.id, conn);
      } else if (remoteSid) {
        m.remoteSid = remoteSid;
        m.lastDisconnectAt = 0;
      }
      if (this.phase !== 'lobby') {
        const sp = this.sim.players.get(m.id);
        if (sp) sp.connected = true;
        this.pending.push({ to: null, msg: { t: 'notice', msg: `${m.name} reconnected` } });
        this.push({ t: 'conn', i: m.id, on: true });
      }
      this.broadcastRoom();
      return m;
    }
    return null;
  }

  removeMember(memberId: string, reason: 'disconnected' | 'left'): void {
    const m = this.members.get(memberId);
    if (!m) return;
    this.members.delete(memberId);
    this.sim.removePlayer(memberId);
    if (reason === 'left' && this.phase !== 'lobby') {
      this.pending.push({ to: null, msg: { t: 'notice', msg: `${m.name} left the match` } });
    }
    if (this.hostId === memberId) {
      const next = [...this.members.values()][0];
      this.hostId = next ? next.id : '';
      if (next) {
        this.pending.push({ to: null, msg: { t: 'notice', msg: `${next.name} is the new host` } });
        this.pending.push({ to: next.id, msg: { t: 'notice', msg: 'You are the new host' } });
        this.push({ t: 'host', i: next.id });
      }
    }
    if (this.members.size === 0) {
      this.host.onEmpty(this.code);
      return;
    }
    this.broadcastRoom();
  }

  memberByToken(token: string): Member | null {
    for (const m of this.members.values()) if (m.token === token) return m;
    return null;
  }

  member(memberId: string): Member | null {
    return this.members.get(memberId) ?? null;
  }

  // ── Lobby actions ──────────────────────────────────────────────────────

  setReady(memberId: string, ready: boolean): boolean {
    const m = this.members.get(memberId);
    if (!m) return false;
    m.ready = ready;
    this.broadcastRoom();
    return true;
  }

  startMatch(memberId: string): { ok: boolean; error?: string } {
    if (memberId !== this.hostId) return { ok: false, error: 'Only the host can start the match.' };
    if (this.phase !== 'lobby') return { ok: false, error: 'Match already running.' };
    if (this.connectedCount() < 1) return { ok: false, error: 'No connected players.' };
    this.sim.startMatch(this.host.now());
    this.broadcastRoom();
    return { ok: true };
  }

  rematch(memberId: string): { ok: boolean; error?: string } {
    if (memberId !== this.hostId) return { ok: false, error: 'Waiting for the host to restart.' };
    if (this.phase !== 'over') return { ok: false, error: 'Match is not over yet.' };
    this.sim.rematch(this.host.now());
    this.lastResults = null;
    this.winnerName = null;
    this.broadcastRoom();
    return { ok: true };
  }

  backToLobby(memberId: string): { ok: boolean; error?: string } {
    if (memberId !== this.hostId) return { ok: false, error: 'Only the host can return everyone to the lobby.' };
    if (this.phase === 'lobby') return { ok: true };
    this.sim.backToLobby();
    this.overAt = 0;
    this.broadcastRoom();
    return { ok: true };
  }

  chat(memberId: string, text: string) {
    const m = this.members.get(memberId);
    if (!m) return;
    const msg: ServerMsg = { t: 'chat', f: m.name, m: text };
    this.pending.push({ to: null, msg });
  }

  switchWeapon(memberId: string, w: WeaponId): boolean {
    const p = this.sim.players.get(memberId);
    if (!p) return false;
    return this.sim.switchWeapon(p, w, this.host.now());
  }

  // ── Outputs ────────────────────────────────────────────────────────────

  private push(ev: GameEvent) {
    this.sim.events.push(ev);
  }

  roomState(): RoomState {
    const players = [...this.members.values()].map((m) => {
      const sp = this.sim.players.get(m.id);
      return {
        id: m.id,
        name: m.name,
        ready: m.ready,
        connected: m.conns.size > 0 || m.remote,
        kills: sp ? sp.kills : 0,
        deaths: sp ? sp.deaths : 0,
      };
    });
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      mapId: this.mapId,
      players,
      ...(this.sim.phase === 'countdown' ? { countdownAt: this.sim.goAt } : {}),
      ...(this.sim.phase === 'playing' ? { matchEndsAt: this.sim.matchEndsAt } : {}),
      killTarget: C.KILL_TARGET,
      timeLimitMs: C.TIME_LIMIT_MS,
      winner: this.sim.winner,
    };
  }

  broadcastRoom() {
    this.pending.push({ to: null, msg: { t: 'room', room: this.roomState() } });
  }

  sendWelcome(m: Member) {
    this.pending.push({ to: m.id, msg: { t: 'welcome', pid: m.id, token: m.token, room: this.code } });
  }

  /** Advance the room one server tick; flush outputs to the host. */
  update(now: number) {
    if (this.phase !== 'lobby') {
      this.sim.update(now);
      const snap: Snapshot = this.sim.snapshot();
      this.lastSnap = snap;
      // snapshot to everyone
      this.pending.push({ to: null, msg: { t: 'snap', snap } });
      this.sim.clearEvents();
      if (this.sim.phase === 'over') {
        if (!this.overAt) {
          this.overAt = now;
          this.lastResults = this.sim.results();
          this.winnerName = this.lastResults.winner
            ? this.members.get(this.lastResults.winner)?.name ?? null
            : null;
          this.pending.push({ to: null, msg: { t: 'over', results: this.lastResults } });
          this.broadcastRoom();
        } else if (now - this.overAt > 20000) {
          this.sim.backToLobby();
          this.overAt = 0;
          this.broadcastRoom();
        }
      }
    }
    // disconnect grace expiry (matches only)
    for (const m of [...this.members.values()]) {
      if (!m.remote && m.conns.size === 0 && m.lastDisconnectAt && this.phase !== 'lobby') {
        if (now - m.lastDisconnectAt > C.DISCONNECT_GRACE_MS) {
          this.removeMember(m.id, 'disconnected');
        }
      }
    }
    if (this.pending.length > 0) {
      const out = this.pending;
      this.pending = [];
      this.host.deliver(this.code, out);
    }
  }

  /** Deliver any queued outputs immediately (membership changes etc.). */
  flush() {
    if (this.pending.length > 0) {
      const out = this.pending;
      this.pending = [];
      this.host.deliver(this.code, out);
    }
  }
}

export function pickMapId(): MapId {
  return MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)] as MapId;
}

export { makeRoomCode, validateCode };
