/**
 * Networking hub for the HTTP short-poll transport (Vercel-compatible
 * realtime).
 *
 * One hub per server instance. Players connect with a single endpoint:
 *   POST /api/rt/msg  { sid, msgs } → { out: ServerMsg[] }
 * Each request carries uplink messages and returns the session's buffered
 * downlink messages. Nothing is held open, so every request is short and the
 * platform keeps routing it to the same warm instance (rooms live in that
 * instance's memory).
 *
 * Rooms are simulated by exactly one instance (lease owner). When Redis is
 * configured, other instances stream the published room blob to their local
 * sessions and forward uplink traffic to the owner via an inbox list; if the
 * owner dies, another instance adopts the room from the last blob.
 */
import type { ClientMsg, ServerMsg } from '../../shared/types';
import type { MapId } from '../../shared/maps';
import { RoomManager, type ManagedConn } from '../rooms/manager';
import { Room, type RoomOutput } from '../rooms/room';
import { errorText } from '../validation';
import { getStore, type RealtimeStore, type RoomBlob } from '../store';
import { RateLimiter } from './ratelimit';

const LEASE_TTL_MS = 4000;
const BLOB_TTL_SEC = 8;
const TICK_MS = 1000 / 30;

export interface Session {
  sid: string;
  conn: ManagedConn;
  roomId: string | null;
  lastBlobTs: number;
  lastSnapTick: number;
  lastChatId: number;
  lastNoticeId: number;
  closed: boolean;
  /** Outbound messages waiting for the next client poll. */
  buf: ServerMsg[];
  /** Last client poll — sessions that stop polling are swept. */
  lastPollAt: number;
}

const SESSION_BUF_MAX = 200;
/** A session that hasn't polled for this long is treated as disconnected. */
const SESSION_LIVENESS_MS = 15_000;

interface HubGlobal {
  instanceId: string;
  mgr: HubRoomManager;
  store: RealtimeStore;
  sessions: Map<string, Session>;
  remoteConns: Map<string, ManagedConn>;
  chats: Map<string, { id: number; f: string; m: string }[]>;
  notices: Map<string, { id: number; m: string }[]>;
  seq: Map<string, number>;
  lastBlobPublish: Map<string, number>;
  lastLeaseRenew: Map<string, number>;
  lastAdoptTry: Map<string, number>;
  blobDirty: Set<string>;
  ticking: boolean;
  polling: boolean;
  timer: ReturnType<typeof setInterval> | null;
  onRoomOutputs(code: string, out: RoomOutput[]): void;
  /** Wired to the Hub instance (see Hub.instance). */
  onRoomCreated(code: string): Promise<void> | void;
}

declare global {
  // eslint-disable-next-line no-var
  var __JSA_HUB__: HubGlobal | undefined;
}

export class HubRoomManager extends RoomManager {
  constructor(private hub: HubGlobal) {
    super();
  }

  /** Extended delivery: remote members get targeted messages via the store. */
  deliver(code: string, out: RoomOutput[]): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const o of out) {
      if (o.to === null) {
        for (const m of room.members.values()) {
          for (const c of m.conns) c.send(o.msg);
        }
      } else {
        const m = room.members.get(o.to);
        if (m) {
          if (m.conns.size > 0) {
            for (const c of m.conns) c.send(o.msg);
          } else if (m.remote && m.remoteSid) {
            void this.hub.store.pushOut(m.remoteSid, o.msg).catch(() => {});
          }
        }
      }
    }
    this.hub.onRoomOutputs(code, out);
  }

  /** Mirror token → room in the shared store (cross-instance reconnects). */
  protected override onTokenIndexed(code: string, token: string): void {
    if (this.hub.store.mode === 'redis') {
      void this.hub.store.setTokenIndex(token, code).catch(() => {});
    }
  }

  /** A room was created on this instance: claim the lease + publish the blob
   * right away, before the tick loop runs. */
  override createRoom(conn: ManagedConn, name: string, token?: string, mapId?: MapId): Room {
    const room = super.createRoom(conn, name, token, mapId);
    void this.hub.onRoomCreated(room.code);
    return room;
  }
}

function getGlobal(): HubGlobal {
  if (globalThis.__JSA_HUB__) return globalThis.__JSA_HUB__;
  const g: HubGlobal = {
    instanceId: `inst_${Math.random().toString(36).slice(2, 10)}`,
    mgr: null as unknown as HubRoomManager,
    store: getStore(),
    sessions: new Map(),
    remoteConns: new Map(),
    chats: new Map(),
    notices: new Map(),
    seq: new Map(),
    lastBlobPublish: new Map(),
    lastLeaseRenew: new Map(),
    lastAdoptTry: new Map(),
    blobDirty: new Set(),
    ticking: false,
    polling: false,
    timer: null,
    onRoomOutputs: () => {},
    onRoomCreated: () => {},
  };
  g.mgr = new HubRoomManager(g);
  globalThis.__JSA_HUB__ = g;
  return g;
}

export function getHub(): Hub {
  return Hub.instance();
}

export class Hub {
  private g: HubGlobal;

  private constructor(g: HubGlobal) {
    this.g = g;
    g.timer = setInterval(() => void this.loop(), TICK_MS);
    if (typeof g.timer === 'object' && 'unref' in (g.timer as object)) {
      (g.timer as { unref(): void }).unref();
    }
  }

  static instance(): Hub {
    const g = getGlobal();
    if (!g.mgr) {
      // recreate after HMR wipe
      g.mgr = new HubRoomManager(g);
    }
    if (!Hub._i) Hub._i = new Hub(g);
    else Hub._i.g = g;
    // (Re)wire the host hooks every time — managers are recreated on HMR wipe
    // and the previous no-op wiring would silently lose blob/chat tracking.
    g.onRoomOutputs = (code, out) => Hub._i!.onRoomOutputs(code, out);
    g.onRoomCreated = (code) => Hub._i!.onRoomCreated(code);
    return Hub._i;
  }

  private static _i: Hub | null = null;

  get store(): RealtimeStore {
    return this.g.store;
  }

  get mode(): 'memory' | 'redis' {
    return this.g.store.mode;
  }

  // ── Sessions (short-poll transport) ────────────────────────────────────

  /** Register a session. The client polls POST /api/rt/msg every ~33 ms;
   * each poll drains the session's outbound buffer and refreshes liveness. */
  attachSession(sid: string): Session {
    const conn: ManagedConn = {
      id: sid,
      send: (msg: ServerMsg) => {
        const session = this.g.sessions.get(sid);
        if (!session) return;
        session.buf.push(msg);
        while (session.buf.length > SESSION_BUF_MAX) session.buf.shift();
      },
      close: () => {
        this.detachSession(sid);
      },
      rate: new RateLimiter(),
      roomId: null,
      playerId: null,
      name: null,
    };
    const session: Session = {
      sid,
      conn,
      roomId: null,
      lastBlobTs: 0,
      lastSnapTick: 0,
      lastChatId: 0,
      lastNoticeId: 0,
      closed: false,
      buf: [],
      lastPollAt: Date.now(),
    };
    this.g.sessions.set(sid, session);
    return session;
  }

  /** Drain the session's outbound messages (one client poll). Attaches the
   * session on the first poll — polls are how the server learns a client is
   * alive, so there is no separate connect step. */
  async pollSession(sid: string, max: number): Promise<ServerMsg[] | null> {
    let session = this.g.sessions.get(sid);
    if (!session) {
      // Redis mode: a route record means the session lives on another
      // instance — don't create a shadow copy here.
      if (this.g.store.mode === 'redis') {
        const route = await this.g.store.getSessionRoute(sid).catch(() => null);
        if (route?.room) return null;
      }
      session = this.attachSession(sid);
    }
    session.lastPollAt = Date.now();
    if (session.buf.length === 0) return [];
    return session.buf.splice(0, max);
  }

  detachSession(sid: string): void {
    const session = this.g.sessions.get(sid);
    if (!session) return;
    session.closed = true;
    this.g.sessions.delete(sid);
    const { roomId } = session;
    if (roomId) {
      const localRoom = this.g.mgr.rooms.get(roomId);
      if (localRoom && session.conn.roomId === roomId) {
        this.g.mgr.onConnClosed(session.conn);
      } else if (this.g.store.mode === 'redis') {
        void this.g.store
          .pushInbox(roomId, { sid, msg: { t: '_disc' } })
          .catch(() => {});
      }
    }
    this.g.remoteConns.delete(sid);
    void this.g.store.setSessionRoute(sid, { room: null, pid: null }).catch(() => {});
    void this.g.store.dropSession(sid).catch(() => {});
  }

  /** Drop sessions that stopped polling (closed tab, network death). They go
   * through the same path as an explicit leave: disconnect grace in a match,
   * immediate removal in a lobby. */
  private sweepSessions(now: number): void {
    for (const [sid, session] of [...this.g.sessions]) {
      if (session.closed) continue;
      if (now - session.lastPollAt > SESSION_LIVENESS_MS) this.detachSession(sid);
    }
  }

  sessionCount(): number {
    return this.g.sessions.size;
  }

  // ── Uplink ─────────────────────────────────────────────────────────────

  async handleUplink(sid: string, raw: unknown): Promise<boolean> {
    let session = this.g.sessions.get(sid);
    if (!session) {
      // Redis mode: a route record means the session lives on another
      // instance — route through the store instead of re-creating it here.
      if (this.g.store.mode === 'redis') {
        const route = await this.g.store.getSessionRoute(sid).catch(() => null);
        if (route?.room) return this.handleRemote(sid, raw);
      }
      session = this.attachSession(sid);
    }
    return this.handleLocal(session, raw);
  }

  /** Uplink on the instance that owns the session. */
  private async handleLocal(session: Session, raw: unknown): Promise<boolean> {
    const t = (raw as { t?: string } | null)?.t;
    const { mgr, store } = this.g;
    const sid = session.sid;

    const routeRemote = async (code: string) => {
      await store.pushInbox(code, { sid, msg: raw }).catch(() => {});
    };

    if (t === 'join') {
      const code = (raw as { code?: string }).code;
      if (typeof code === 'string' && !mgr.rooms.has(code.toUpperCase())) {
        if (store.mode === 'redis') {
          await routeRemote(code.toUpperCase());
          return true;
        }
      }
      mgr.handleMessage(session.conn, raw);
      return true;
    }

    if (t === 'hello' && store.mode === 'redis') {
      const token = (raw as { token?: string }).token;
      if (typeof token === 'string' && !mgr.tokenIndex.has(token)) {
        const code = await store.getTokenIndex(token);
        if (code) {
          await routeRemote(code);
          return true;
        }
      }
      mgr.handleMessage(session.conn, raw);
      return true;
    }

    // messages that require a room: route to the room's owner when remote
    const roomMsg = ['leave', 'ready', 'start', 'rematch', 'lobby', 'input', 'switch', 'chat'];
    if (t && roomMsg.includes(t) && session.roomId && !mgr.rooms.has(session.roomId)) {
      if (store.mode === 'redis') {
        await routeRemote(session.roomId);
        return true;
      }
    }

    mgr.handleMessage(session.conn, raw);
    return true;
  }

  /** Uplink that landed on an instance other than the one holding the SSE
   * stream. Everything routes through the store so the room's owner processes
   * it and replies reach the stream instance via its out-queue. */
  private async handleRemote(sid: string, raw: unknown): Promise<boolean> {
    const g = this.g;
    const t = (raw as { t?: string } | null)?.t;
    const reply = (m: ServerMsg) => g.store.pushOut(sid, m).catch(() => {});

    switch (t) {
      case 'ping':
        await reply({ t: 'pong', ts: (raw as { ts?: number }).ts ?? 0 });
        return true;

      case 'hello': {
        // Reconnect: find the room that issued this token and process there.
        const token = (raw as { token?: string }).token;
        if (typeof token === 'string') {
          const code = await g.store.getTokenIndex(token).catch(() => null);
          if (code) {
            await g.store.pushInbox(code, { sid, msg: raw }).catch(() => {});
            return true;
          }
        }
        await reply({ t: 'welcome', pid: 'guest', token: '' });
        return true;
      }

      case 'create':
      case 'quick':
        // No room exists yet — create it on THIS instance. The member is
        // attached remotely (stream lives elsewhere); replies flow via out:sid.
        g.mgr.handleMessage(this.facadeFor(sid, null), raw);
        return true;

      case 'join': {
        const rawCode = (raw as { code?: string }).code;
        const code = typeof rawCode === 'string' ? rawCode.toUpperCase() : null;
        if (code && g.mgr.rooms.has(code)) {
          g.mgr.handleMessage(this.facadeFor(sid, code), raw);
          return true;
        }
        if (code) {
          const blob = await g.store.getBlob(code).catch(() => null);
          if (blob) {
            await g.store.pushInbox(code, { sid, msg: raw }).catch(() => {});
            return true;
          }
        }
        await reply({ t: 'error', code: 'room_not_found', msg: errorText('room_not_found') });
        return true;
      }

      default:
        break;
    }

    // Room-bound messages: route to the room's owner. The route record was
    // written when the stream instance drained the welcome.
    const roomMsg = ['leave', 'ready', 'start', 'rematch', 'lobby', 'input', 'switch', 'chat'];
    const route = await g.store.getSessionRoute(sid).catch(() => null);
    if (route?.room && t && roomMsg.includes(t)) {
      await g.store.pushInbox(route.room, { sid, msg: raw }).catch(() => {});
      return true;
    }
    return false;
  }

  /** Reusable proxy conn for a remote session, keyed by sid. The room owner
   * (or the instance that creates the room) keeps it so input frames carry
   * the playerId assigned at join time. */
  private facadeFor(sid: string, roomId: string | null): ManagedConn {
    const g = this.g;
    let facade = g.remoteConns.get(sid);
    if (!facade) {
      facade = {
        id: sid,
        send: (m: ServerMsg) => {
          void g.store.pushOut(sid, m).catch(() => {});
        },
        close: () => {},
        rate: new RateLimiter(),
        roomId,
        playerId: null,
        name: null,
        remoteSid: sid,
      };
      g.remoteConns.set(sid, facade);
    }
    return facade;
  }

  // ── Host hooks ─────────────────────────────────────────────────────────

  private onRoomOutputs(code: string, out: RoomOutput[]): void {
    const g = this.g;
    for (const o of out) {
      if (o.msg.t === 'chat') {
        const list = g.chats.get(code) ?? [];
        const id = (g.seq.get(`chat:${code}`) ?? 0) + 1;
        g.seq.set(`chat:${code}`, id);
        list.push({ id, f: o.msg.f, m: o.msg.m });
        while (list.length > 12) list.shift();
        g.chats.set(code, list);
      } else if (o.msg.t === 'notice') {
        const list = g.notices.get(code) ?? [];
        const id = (g.seq.get(`notice:${code}`) ?? 0) + 1;
        g.seq.set(`notice:${code}`, id);
        list.push({ id, m: o.msg.msg });
        while (list.length > 12) list.shift();
        g.notices.set(code, list);
      }
    }
    g.blobDirty.add(code);
  }

  /** Called when a room was created locally (Redis mode publishes it). */
  async onRoomCreated(code: string): Promise<void> {
    const g = this.g;
    if (g.store.mode !== 'redis') return;
    const adopted = await g.store.tryAdopt(code, g.instanceId, LEASE_TTL_MS).catch(() => false);
    if (adopted) g.lastLeaseRenew.set(code, Date.now());
    await this.publishBlob(code);
  }

  private async publishBlob(code: string): Promise<void> {
    const g = this.g;
    const room = g.mgr.rooms.get(code);
    if (!room) return;
    const members = [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      token: m.token,
      ready: m.ready,
      remote: m.remote && m.conns.size === 0,
      remoteSid: m.remoteSid,
      lastDisconnectAt: m.lastDisconnectAt,
    }));
    const blob: RoomBlob = {
      code,
      ownerId: g.instanceId,
      members,
      room: room.roomState(),
      snap: room.lastSnap,
      chats: g.chats.get(code) ?? [],
      notices: g.notices.get(code) ?? [],
      ts: Date.now(),
    };
    await g.store.setBlob(code, blob, BLOB_TTL_SEC).catch(() => {});
    g.lastBlobPublish.set(code, Date.now());
    g.blobDirty.delete(code);
  }

  // ── Loops ──────────────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    const g = this.g;
    if (g.ticking) return;
    g.ticking = true;
    try {
      mgrTick(g);
      this.sweepSessions(Date.now());
      if (g.store.mode === 'redis') {
        await this.redisTick();
      }
      void this.pollSessions();
    } finally {
      g.ticking = false;
    }
  }

  private async redisTick(): Promise<void> {
    const g = this.g;
    const now = Date.now();
    for (const code of [...g.mgr.rooms.keys()]) {
      const room = g.mgr.rooms.get(code);
      if (!room) continue;
      // lease maintenance — renew ours, adopt a free/expired one, lose if owned
      const lastRenew = g.lastLeaseRenew.get(code) ?? 0;
      if (now - lastRenew > LEASE_TTL_MS / 3) {
        g.lastLeaseRenew.set(code, now);
        const res = await g.store
          .renewOrAdoptLease(code, g.instanceId, LEASE_TTL_MS)
          .catch(() => 'lost' as const);
        if (res === 'lost') {
          // another live instance owns it — drop the local copy; it takes over
          for (const m of [...room.members.values()]) {
            for (const c of m.conns) {
              c.roomId = null;
              c.playerId = null;
            }
          }
          g.mgr.rooms.delete(code);
          continue;
        }
      }
      // drain cross-instance inbox
      const items = await g.store.drainInbox(code, 40).catch(() => []);
      for (const item of items) {
        const msg = item.msg as { t?: string };
        if (msg && msg.t === '_disc') {
          room.remoteDisconnect(item.sid);
          continue;
        }
        g.mgr.handleMessage(this.facadeFor(item.sid, code), item.msg);
        if (!g.mgr.rooms.has(code)) break;
      }
      room.flush();
      // publish cadence: every 2nd tick while a match runs, on change, or 1/s idle
      const room2 = g.mgr.rooms.get(code);
      if (!room2) continue;
      const lastPub = g.lastBlobPublish.get(code) ?? 0;
      const playing = room2.phase !== 'lobby';
      const due = playing ? (room2.sim.tick % 2 === 0) : now - lastPub > 1000;
      if (due || g.blobDirty.has(code)) {
        await this.publishBlob(code);
      }
    }
  }

  private async pollSessions(): Promise<void> {
    const g = this.g;
    if (g.polling || g.store.mode !== 'redis') return;
    g.polling = true;
    try {
      const now = Date.now();
      const live = [...g.sessions.values()].filter((s) => !s.closed);
      if (live.length === 0) return;

      // 1) Direct replies (welcome/error/pong) for every session — one
      //    round-trip for all of them, not one per session.
      const outs = await g.store
        .drainOutMany(live.map((s) => s.sid), 16)
        .catch(() => new Map<string, ServerMsg[]>());
      const remoteRooms = new Set<string>();
      for (const session of live) {
        for (const m of outs.get(session.sid) ?? []) {
          if (m.t === 'welcome' && m.room) {
            session.roomId = m.room;
            session.conn.playerId = m.pid;
            session.conn.roomId = m.room;
            // remember the route so uplink POSTs on other instances find us
            void g.store
              .setSessionRoute(session.sid, { room: m.room, pid: m.pid })
              .catch(() => {});
          }
          // 'error': leave roomId untouched (join failed)
          session.conn.send(m);
        }
        if (session.roomId && !g.mgr.rooms.has(session.roomId)) {
          remoteRooms.add(session.roomId);
        }
      }
      if (remoteRooms.size === 0) return;

      // 2) Blob feed for rooms owned by another instance — one round-trip.
      const blobs = await g.store
        .getBlobs([...remoteRooms])
        .catch(() => new Map<string, RoomBlob | null>());
      for (const session of live) {
        if (!session.roomId || g.mgr.rooms.has(session.roomId)) continue;
        const blob = blobs.get(session.roomId) ?? null;
        if (!blob) {
          // room vanished (owner died with no successor yet)
          continue;
        }
        if (blob.ownerId !== g.instanceId) {
          const lastTry = g.lastAdoptTry.get(blob.code) ?? 0;
          if (now - lastTry > 1000) {
            g.lastAdoptTry.set(blob.code, now);
            const adopted = await g.store.tryAdopt(blob.code, g.instanceId, LEASE_TTL_MS).catch(() => false);
            if (adopted) {
              this.adoptRoom(blob);
              continue;
            }
          }
        }
        if (blob.ts > session.lastBlobTs) {
          session.lastBlobTs = blob.ts;
          session.conn.send({ t: 'room', room: blob.room });
        }
        if (blob.snap && blob.snap.tick > session.lastSnapTick) {
          session.lastSnapTick = blob.snap.tick;
          session.conn.send({ t: 'snap', snap: blob.snap });
        }
        for (const c of blob.chats) {
          if (c.id > session.lastChatId) {
            session.lastChatId = c.id;
            session.conn.send({ t: 'chat', f: c.f, m: c.m });
          }
        }
        for (const n of blob.notices) {
          if (n.id > session.lastNoticeId) {
            session.lastNoticeId = n.id;
            session.conn.send({ t: 'notice', msg: n.m });
          }
        }
      }
    } finally {
      g.polling = false;
    }
  }

  /** Take over a room from a dead instance using its last published blob. */
  private adoptRoom(blob: RoomBlob): void {
    const g = this.g;
    if (g.mgr.rooms.has(blob.code)) return;
    const room = new Room(blob.code, blob.room.mapId as never, g.mgr, Date.now());
    g.mgr.rooms.set(blob.code, room);
    room.hostId = blob.room.hostId;
    for (const bm of blob.members) {
      const m = room.addMember(bm.name);
      m.id = bm.id;
      m.token = bm.token;
      m.ready = bm.ready;
      if (bm.remote && bm.remoteSid) {
        m.remote = true;
        m.remoteSid = bm.remoteSid;
      }
      g.mgr.tokenIndex.set(m.token, blob.code);
      void g.store.setTokenIndex(m.token, blob.code).catch(() => {});
    }
    // local sessions reading this room become direct members now
    for (const session of g.sessions.values()) {
      if (session.roomId !== blob.code || !session.conn.playerId) continue;
      const m = room.members.get(session.conn.playerId);
      if (m) {
        m.remote = false;
        m.remoteSid = null;
        room.attachConn(m.id, session.conn);
      }
    }
    restoreSimFromBlob(room, blob);
    room.broadcastRoom();
    room.flush();
    g.lastLeaseRenew.set(blob.code, Date.now());
    g.blobDirty.add(blob.code);
  }
}

function mgrTick(g: HubGlobal): void {
  g.mgr.tick();
}

/**
 * Approximate restoration of simulation state after instance adoption.
 * Precise timers (reload/fire cadence) are reset; positions, velocities,
 * health, ammo, scores, projectiles and pickups are restored.
 */
function restoreSimFromBlob(room: Room, blob: RoomBlob): void {
  const sim = room.sim;
  const now = Date.now();
  const phase = blob.room.phase;
  sim.phase = phase;
  if (phase === 'countdown' && blob.room.countdownAt) sim.goAt = blob.room.countdownAt;
  if (phase === 'playing' && blob.room.matchEndsAt) sim.matchEndsAt = blob.room.matchEndsAt;

  const snap = blob.snap;
  if (!snap) {
    for (const m of blob.members) sim.addPlayer(m.id, m.name, now);
    return;
  }
  let maxB = 0;
  for (const ps of snap.ps) {
    const member = blob.members.find((x) => x.id === ps.i);
    const p = sim.addPlayer(ps.i, member?.name ?? 'Player', now);
    p.ms.body.x = ps.x;
    p.ms.body.y = ps.y;
    p.ms.body.vx = ps.vx;
    p.ms.body.vy = ps.vy;
    p.aim = ps.a;
    p.hp = ps.hp;
    p.alive = ps.al === 1;
    if (!p.alive) p.respawnAt = now + 1000;
    p.weapon = ps.w;
    p.owned = new Set(['pistol' as const, ps.w]);
    p.mag = ps.m;
    p.reserve = ps.r;
    p.ms.fuel = ps.f;
    p.kills = ps.k;
    p.deaths = ps.d;
    p.grenades = ps.na;
    p.lastSeq = ps.si;
  }
  for (const b of snap.bs) {
    sim.bullets.push({
      id: b.i,
      owner: b.o,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      weapon: b.w,
      dist: 0,
      dead: false,
    });
    maxB = Math.max(maxB, b.i);
  }
  sim.grenades = snap.gs.map((gr) => ({
    id: gr.i,
    owner: '',
    body: { x: gr.x, y: gr.y, vx: gr.vx, vy: gr.vy },
    fuse: gr.fu,
    dead: false,
  }));
  for (const pk of sim.pickups) {
    const s = snap.pk.find((x) => x.i === pk.id);
    pk.active = !!s;
    if (!pk.active) {
      pk.respawnAt = now + (pk.spot.kind === 'health' ? 10000 : pk.spot.kind === 'ammo' ? 12000 : 15000);
    }
  }
}
