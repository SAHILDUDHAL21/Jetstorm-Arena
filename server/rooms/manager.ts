/**
 * RoomManager: owns all rooms in this process, routes validated client
 * messages, handles create/join/quick/reconnect, and drives the 30 Hz tick.
 */
import type { ServerMsg, WeaponId } from '../../shared/types';
import type { MapId } from '../../shared/maps';
import { RateLimiter } from '../networking/ratelimit';
import { errorText, makeRoomCode, parseClientMsg, validateCode } from '../validation';
import { Room, pickMapId, type Member, type RoomHost, type RoomOutput, type ServerConn } from './room';

export interface ManagedConn extends ServerConn {
  rate: RateLimiter;
  name: string | null;
  /** set when this "connection" is a remote session proxied via the store */
  remoteSid?: string;
}

export class RoomManager implements RoomHost {
  rooms = new Map<string, Room>();
  /** token → roomId for reconnects */
  tokenIndex = new Map<string, string>();
  private connCounter = 1;

  nextConnId(): string {
    return `c${this.connCounter++}`;
  }

  now(): number {
    return Date.now();
  }

  /** Hook for Redis-backed hosts: mirror token → room so reconnects can be
   * routed from any instance. */
  protected onTokenIndexed(_code: string, _token: string): void {}

  /** Attach a member to a connection. Remote (cross-instance) sessions have
   * no real conn here — the facade's routing fields must still be filled in,
   * or later uplink batches (input frames) are rejected as "not in a room". */
  protected attachMember(room: Room, m: Member, conn: ManagedConn): void {
    if (conn.remoteSid) {
      room.attachRemote(m.id, conn.remoteSid);
      conn.roomId = room.code;
      conn.playerId = m.id;
    } else {
      room.attachConn(m.id, conn);
    }
    conn.name = m.name;
  }

  // ── RoomHost ───────────────────────────────────────────────────────────

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
        if (m) for (const c of m.conns) c.send(o.msg);
      }
    }
  }

  onEmpty(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const m of room.members.values()) {
      this.tokenIndex.delete(m.token);
      for (const c of m.conns) {
        c.roomId = null;
        c.playerId = null;
      }
    }
    this.rooms.delete(code);
  }

  onChanged(_code: string): void {
    // used by Redis-backed host; base manager is in-memory only
  }

  // ── Connections ────────────────────────────────────────────────────────

  makeConn(base: ServerConn): ManagedConn {
    return { ...base, rate: new RateLimiter(), name: null };
  }

  /** Entry point for every raw inbound message from any transport. */
  handleMessage(conn: ManagedConn, raw: unknown): void {
    const parsed = parseClientMsg(raw);
    if (!parsed.ok || !parsed.msg) {
      conn.send({ t: 'error', code: parsed.error ?? 'bad_message', msg: errorText(parsed.error ?? 'bad_message') });
      return;
    }
    const msg = parsed.msg;
    const isInput = msg.t === 'input';
    const isChat = msg.t === 'chat';
    const bucket = isInput ? 'input' : isChat ? 'chat' : 'control';
    if (!conn.rate.allow(bucket)) {
      if (conn.rate.abusive()) {
        conn.send({ t: 'error', code: 'rate_limited', msg: 'You are sending messages too quickly.' });
        conn.close();
      } else if (!isInput) {
        conn.send({ t: 'error', code: 'rate_limited', msg: errorText('rate_limited') });
      }
      return;
    }

    switch (msg.t) {
      case 'ping':
        conn.send({ t: 'pong', ts: msg.ts });
        return;
      case 'hello': {
        // Reconnect path: token matches a disconnected member anywhere.
        const roomId = msg.token ? this.tokenIndex.get(msg.token) : undefined;
        if (roomId) {
          const room = this.rooms.get(roomId);
          const m = room?.memberByToken(msg.token!);
          if (room && m) {
            this.attachMember(room, m, conn);
            room.sendWelcome(m);
            room.broadcastRoom();
            room.flush();
            return;
          }
        }
        // No room yet — just acknowledge identity.
        conn.send({ t: 'welcome', pid: 'guest', token: msg.token ?? '' });
        return;
      }
      case 'create': {
        if (conn.roomId) {
          conn.send({ t: 'error', code: 'already_in_room', msg: errorText('already_in_room') });
          return;
        }
        this.createRoom(conn, msg.name, msg.token, msg.mapId);
        return;
      }
      case 'join': {
        if (conn.roomId) {
          conn.send({ t: 'error', code: 'already_in_room', msg: errorText('already_in_room') });
          return;
        }
        this.joinRoom(conn, msg.code, msg.name, msg.token);
        return;
      }
      case 'quick': {
        if (conn.roomId) {
          conn.send({ t: 'error', code: 'already_in_room', msg: errorText('already_in_room') });
          return;
        }
        this.quickplay(conn, msg.name, msg.token);
        return;
      }
      default:
        break;
    }

    // Everything below requires membership.
    if (!conn.roomId || !conn.playerId) {
      conn.send({ t: 'error', code: 'bad_message', msg: 'Join a room first.' });
      return;
    }
    const room = this.rooms.get(conn.roomId);
    if (!room) return;
    room.lastActivity = this.now();

    switch (msg.t) {
      case 'leave': {
        room.removeMember(conn.playerId, 'left');
        return;
      }
      case 'ready':
        room.setReady(conn.playerId, msg.ready);
        return;
      case 'start': {
        const res = room.startMatch(conn.playerId);
        if (!res.ok) conn.send({ t: 'error', code: 'not_host', msg: res.error ?? 'Cannot start.' });
        return;
      }
      case 'rematch': {
        if (room.phase === 'over' || room.phase === 'lobby') {
          const res = room.phase === 'over' ? room.rematch(conn.playerId) : room.startMatch(conn.playerId);
          if (!res.ok) conn.send({ t: 'error', code: 'not_host', msg: res.error ?? 'Cannot rematch.' });
        }
        return;
      }
      case 'lobby': {
        const res = room.backToLobby(conn.playerId);
        if (!res.ok) conn.send({ t: 'error', code: 'not_host', msg: res.error ?? 'Cannot return to lobby.' });
        return;
      }
      case 'switch':
        room.switchWeapon(conn.playerId, msg.w as WeaponId);
        return;
      case 'chat':
        room.chat(conn.playerId, msg.text);
        room.flush();
        return;
      case 'input':
        room.sim.queueInput(conn.playerId, msg.frames);
        return;
      default:
        return;
    }
  }

  onConnClosed(conn: ManagedConn): void {
    if (!conn.roomId) return;
    const room = this.rooms.get(conn.roomId);
    if (!room) return;
    room.detachConn(conn);
    room.flush();
  }

  // ── Room lifecycle ─────────────────────────────────────────────────────

  createRoom(conn: ManagedConn, name: string, token?: string, mapId?: MapId): Room {
    let code = makeRoomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = makeRoomCode();
    const room = new Room(code, mapId ?? pickMapId(), this, this.now());
    this.rooms.set(code, room);
    const m = room.addMember(name);
    if (token && /^[A-Za-z0-9_-]{8,64}$/.test(token)) {
      // caller supplied a previous token (returning player) — honor it
      m.token = token;
    }
    this.tokenIndex.set(m.token, code);
    this.onTokenIndexed(code, m.token);
    this.attachMember(room, m, conn);
    room.sendWelcome(m);
    room.broadcastRoom();
    room.flush();
    return room;
  }

  joinRoom(conn: ManagedConn, codeRaw: string, name: string, token?: string): void {
    const code = validateCode(codeRaw);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) {
      conn.send({ t: 'error', code: 'room_not_found', msg: errorText('room_not_found') });
      return;
    }
    // Reconnect into existing slot?
    if (token) {
      const m = room.memberByToken(token);
      if (m) {
        this.tokenIndex.set(token, code!);
        this.onTokenIndexed(code!, token);
        this.attachMember(room, m, conn);
        room.sendWelcome(m);
        room.broadcastRoom();
        room.flush();
        return;
      }
    }
    if (room.isFull()) {
      conn.send({ t: 'error', code: 'room_full', msg: errorText('room_full') });
      return;
    }
    const m = room.addMember(name);
    if (token && /^[A-Za-z0-9_-]{8,64}$/.test(token)) m.token = token;
    this.tokenIndex.set(m.token, code!);
    this.onTokenIndexed(code!, m.token);
    this.attachMember(room, m, conn);
    if (room.phase !== 'lobby') {
      // addMember already spawned the sim player — late joiner is live now.
      room.pending.push({ to: null, msg: { t: 'notice', msg: `${name} joined the match` } });
    }
    room.sendWelcome(m);
    room.broadcastRoom();
    room.flush();
  }

  quickplay(conn: ManagedConn, name: string, token?: string): void {
    for (const room of this.rooms.values()) {
      if (room.isFull()) continue;
      if (room.phase === 'lobby') {
        this.joinRoom(conn, room.code, name, token);
        return;
      }
    }
    for (const room of this.rooms.values()) {
      if (!room.isFull()) {
        this.joinRoom(conn, room.code, name, token);
        return;
      }
    }
    this.createRoom(conn, name, token);
  }

  /** Advance every room one tick (call at 30 Hz). */
  tick(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      room.update(now);
    }
    this.gc(now);
  }

  private gc(now: number) {
    for (const [code, room] of this.rooms) {
      const anyConnected = [...room.members.values()].some((m) => m.conns.size > 0 || m.remote);
      if (!anyConnected && now - room.lastActivity > 90_000) {
        this.onEmpty(code);
      } else if (room.phase === 'lobby') {
        // drop disconnected lobby members quickly
        for (const m of [...room.members.values()]) {
          if (!m.remote && m.conns.size === 0 && m.lastDisconnectAt && now - m.lastDisconnectAt > 10_000) {
            room.removeMember(m.id, 'disconnected');
          }
        }
      }
    }
  }

  roomFor(conn: ManagedConn): Room | null {
    return conn.roomId ? this.rooms.get(conn.roomId) ?? null : null;
  }

  /** Test helper: current welcome message stream for a conn. */
  sendTo(conn: ManagedConn, msg: ServerMsg): void {
    conn.send(msg);
  }
}
