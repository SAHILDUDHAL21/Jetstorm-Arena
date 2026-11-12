/**
 * NetClient: high-level client networking. Wraps the selected transport,
 * routes server messages to the UI/game, batches input frames, measures
 * RTT, and tracks the server clock offset for interpolation.
 */
import type {
  ClientMsg, InputFrame, RoomState, ServerMsg, Snapshot, WeaponId, MatchResult,
} from '../../shared/types';
import type { MapId } from '../../shared/maps';
import { makeTransport, type NetStatus, type Transport } from './Transport';

export type JoinMode = { kind: 'create' } | { kind: 'join'; code: string } | { kind: 'quick' };

export interface NetHandlers {
  onWelcome?: (pid: string, token: string, room?: string) => void;
  onRoom?: (room: RoomState) => void;
  onSnap?: (snap: Snapshot) => void;
  onOver?: (results: MatchResult) => void;
  onChat?: (from: string, text: string, sys?: boolean) => void;
  onNotice?: (text: string) => void;
  onError?: (code: string, msg: string) => void;
  onStatus?: (status: NetStatus, ping: number | null) => void;
}

export function tokenKey(code: string): string {
  return `jsa:tok:${code}`;
}

export class NetClient {
  transport: Transport;
  status: NetStatus = 'connecting';
  myId = '';
  token = '';
  room: RoomState | null = null;
  latestSnap: Snapshot | null = null;
  handlers: NetHandlers;
  private pendingFrames: InputFrame[] = [];
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private offsets: number[] = [];
  private lastPingSent = 0;
  private connectStarted = false;
  ping: number | null = null;
  name = 'Player';

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
    this.transport = makeTransport();
    this.transport.onMessage = (m) => this.handle(m);
    this.transport.onStatus = (s) => {
      this.status = s;
      // The session can be lost mid-session (instance recycled, network blip).
      // Re-claim the room slot with the issued token once we're reachable
      // again — idempotent: hello without membership just acks.
      if (s === 'online' && this.token) {
        this.transport.send({ t: 'hello', name: this.name, token: this.token });
      }
      this.handlers.onStatus?.(s, this.ping);
    };
  }

  connect(): void {
    // Idempotent: repeated calls (user re-clicking) must not spawn extra
    // sockets or retry chains — the transport reconnects itself offline.
    if (this.connectStarted && this.status !== 'offline') return;
    this.connectStarted = true;
    this.transport.connect();
    if (!this.frameTimer) {
      this.frameTimer = setInterval(() => this.flushFrames(), 33);
      this.pingTimer = setInterval(() => {
        this.lastPingSent = Date.now();
        this.transport.send({ t: 'ping', ts: this.lastPingSent });
      }, 2500);
    }
  }

  destroy(): void {
    if (this.frameTimer) clearInterval(this.frameTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.frameTimer = null;
    this.pingTimer = null;
    this.transport.close();
  }

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.pid;
        // A guest ack (pid 'guest', empty token) must not wipe the real token —
        // it is the only way back into the slot after a stream replacement.
        if (m.token) this.token = m.token;
        this.handlers.onWelcome?.(m.pid, m.token, m.room);
        break;
      case 'error':
        this.handlers.onError?.(m.code, m.msg);
        break;
      case 'room':
        this.room = m.room;
        this.transport.setRate?.(true); // in a room: poll fast
        if (this.token) {
          try {
            sessionStorage.setItem(tokenKey(m.room.code), this.token);
          } catch {
            /* storage unavailable */
          }
        }
        this.handlers.onRoom?.(m.room);
        break;
      case 'snap':
        this.latestSnap = m.snap;
        this.offsets.push(m.snap.time - Date.now());
        if (this.offsets.length > 30) this.offsets.shift();
        this.handlers.onSnap?.(m.snap);
        break;
      case 'over':
        this.handlers.onOver?.(m.results);
        break;
      case 'chat':
        this.handlers.onChat?.(m.f, m.m, m.sys);
        break;
      case 'notice':
        this.handlers.onNotice?.(m.msg);
        break;
      case 'pong':
        this.ping = Date.now() - m.ts;
        this.handlers.onStatus?.(this.status, this.ping);
        break;
      default:
        break;
    }
  }

  /** Estimated server epoch clock (ms). */
  serverNow(): number {
    if (this.offsets.length === 0) return Date.now();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    return Date.now() + sorted[Math.floor(sorted.length / 2)];
  }

  sendRaw(msg: ClientMsg): void {
    this.transport.send(msg);
  }

  sendNameJoin(mode: JoinMode, name: string, token?: string, mapId?: string): void {
    this.name = name;
    if (mode.kind === 'create') this.transport.send({ t: 'create', name, token, mapId: mapId as MapId | undefined });
    else if (mode.kind === 'quick') this.transport.send({ t: 'quick', name, token });
    else this.transport.send({ t: 'join', code: mode.code, name, token });
  }

  sendHello(name: string, token?: string): void {
    this.transport.send({ t: 'hello', name, token });
  }

  ready(ready: boolean): void {
    this.transport.send({ t: 'ready', ready });
  }

  start(): void {
    this.transport.send({ t: 'start' });
  }

  rematch(): void {
    this.transport.send({ t: 'rematch' });
  }

  backToLobby(): void {
    this.transport.send({ t: 'lobby' });
  }

  leave(): void {
    this.transport.send({ t: 'leave' });
  }

  chat(text: string): void {
    this.transport.send({ t: 'chat', text });
  }

  switchWeapon(w: WeaponId): void {
    this.transport.send({ t: 'switch', w });
  }

  /** Queue a single 60 Hz input frame (called from the game loop). */
  sendInputFrame(frame: InputFrame): void {
    if (this.pendingFrames.length < 12) this.pendingFrames.push(frame);
  }

  private flushFrames(): void {
    if (this.pendingFrames.length === 0) return;
    const frames = this.pendingFrames;
    this.pendingFrames = [];
    this.transport.send({ t: 'input', frames });
  }
}
