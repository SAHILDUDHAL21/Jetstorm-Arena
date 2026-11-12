/**
 * Realtime shared-state store for the Vercel SSE transport.
 *
 * - MemoryStore: single-instance development / small deployments.
 * - UpstashStore: multi-instance production via Upstash Redis REST
 *   (room blobs, ownership leases, cross-instance inbox + direct replies).
 *
 * The WebSocket transport (self-hosted) does not use this module at all.
 */
import type { ClientMsg, RoomState, ServerMsg, Snapshot } from '../../shared/types';

export interface BlobMember {
  id: string;
  name: string;
  token: string;
  ready: boolean;
  remote: boolean;
  remoteSid: string | null;
  lastDisconnectAt: number;
}

export interface RoomBlob {
  code: string;
  ownerId: string;
  members: BlobMember[];
  room: RoomState;
  snap: Snapshot | null;
  chats: { id: number; f: string; m: string }[];
  notices: { id: number; m: string }[];
  ts: number;
}

export interface InboxItem {
  sid: string;
  msg: unknown;
}

/** Where a session's SSE stream lives and which room it is in (cross-instance uplink routing). */
export interface SessionRoute {
  room: string | null;
  pid: string | null;
}

export type LeaseResult = 'owned' | 'adopted' | 'lost';

export interface RealtimeStore {
  readonly mode: 'memory' | 'redis';
  getBlob(code: string): Promise<RoomBlob | null>;
  setBlob(code: string, blob: RoomBlob, ttlSec: number): Promise<void>;
  delBlob(code: string): Promise<void>;
  /** SET NX lease — true when this instance now owns the room. */
  tryAdopt(code: string, ownerId: string, ttlMs: number): Promise<boolean>;
  renewLease(code: string, ownerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(code: string, ownerId: string): Promise<void>;
  pushInbox(code: string, item: InboxItem): Promise<void>;
  drainInbox(code: string, max: number): Promise<InboxItem[]>;
  pushOut(sid: string, msg: ServerMsg): Promise<void>;
  drainOut(sid: string, max: number): Promise<ServerMsg[]>;
  /** token → {code} global index for reconnects across instances. */
  setTokenIndex(token: string, code: string): Promise<void>;
  getTokenIndex(token: string): Promise<string | null>;
  /** Cross-instance uplink routing: which room a session belongs to. */
  setSessionRoute(sid: string, route: SessionRoute): Promise<void>;
  getSessionRoute(sid: string): Promise<SessionRoute | null>;
  /**
   * Atomic lease renewal that adopts a free/expired lease instead of failing.
   * 'owned' = renewed, 'adopted' = took over a dead lease, 'lost' = owned elsewhere.
   */
  renewOrAdoptLease(code: string, ownerId: string, ttlMs: number): Promise<LeaseResult>;
  /** Batched drains: one round-trip for many sessions (serverless cost). */
  drainOutMany(sids: string[], max: number): Promise<Map<string, ServerMsg[]>>;
  /** Batched blob reads: one round-trip for many rooms. */
  getBlobs(codes: string[]): Promise<Map<string, RoomBlob | null>>;
  dropSession(sid: string): Promise<void>;
}

// ─── MemoryStore ──────────────────────────────────────────────────────────

interface Entry {
  value: unknown;
  expires: number;
}

export class MemoryStore implements RealtimeStore {
  readonly mode = 'memory' as const;
  private data = new Map<string, Entry>();

  private get(key: string): unknown {
    const e = this.data.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) {
      this.data.delete(key);
      return null;
    }
    return e.value;
  }

  private set(key: string, value: unknown, ttlMs: number) {
    this.data.set(key, { value, expires: Date.now() + ttlMs });
  }

  private delete(key: string) {
    this.data.delete(key);
  }

  async getBlob(code: string) {
    return (this.get(`blob:${code}`) as RoomBlob) ?? null;
  }

  async setBlob(code: string, blob: RoomBlob, ttlSec: number) {
    this.set(`blob:${code}`, blob, ttlSec * 1000);
  }

  async delBlob(code: string) {
    this.delete(`blob:${code}`);
  }

  async tryAdopt(code: string, ownerId: string, ttlMs: number) {
    const key = `lease:${code}`;
    const cur = this.get(key) as { owner: string } | null;
    if (cur && cur.owner !== ownerId && Date.now() <= (this.data.get(key)?.expires ?? 0)) return false;
    this.set(key, { owner: ownerId }, ttlMs);
    return true;
  }

  async renewLease(code: string, ownerId: string, ttlMs: number) {
    const key = `lease:${code}`;
    const cur = this.get(key) as { owner: string } | null;
    if (!cur || cur.owner !== ownerId) return false;
    this.set(key, cur, ttlMs);
    return true;
  }

  async releaseLease(code: string, ownerId: string) {
    const key = `lease:${code}`;
    const cur = this.get(key) as { owner: string } | null;
    if (cur && cur.owner === ownerId) this.delete(key);
  }

  private async pushList(key: string, value: unknown, cap: number, ttlSec: number) {
    const list = (this.get(key) as unknown[]) ?? [];
    list.push(value);
    while (list.length > cap) list.shift();
    this.set(key, list, ttlSec * 1000);
  }

  private async drainList(key: string, max: number): Promise<unknown[]> {
    const list = (this.get(key) as unknown[]) ?? [];
    const out = list.slice(0, max);
    const rest = list.slice(out.length);
    if (rest.length === 0) this.delete(key);
    else this.set(key, rest, 10_000);
    return out;
  }

  async pushInbox(code: string, item: InboxItem) {
    await this.pushList(`inbox:${code}`, item, 600, 10);
  }

  async drainInbox(code: string, max: number) {
    return (await this.drainList(`inbox:${code}`, max)) as InboxItem[];
  }

  async pushOut(sid: string, msg: ServerMsg) {
    await this.pushList(`out:${sid}`, msg, 200, 30);
  }

  async drainOut(sid: string, max: number) {
    return (await this.drainList(`out:${sid}`, max)) as ServerMsg[];
  }

  async setTokenIndex(token: string, code: string) {
    this.set(`tok:${token}`, code, 15 * 60 * 1000);
  }

  async getTokenIndex(token: string) {
    return (this.get(`tok:${token}`) as string) ?? null;
  }

  async setSessionRoute(sid: string, route: SessionRoute) {
    this.set(`route:${sid}`, route, 120_000);
  }

  async getSessionRoute(sid: string) {
    return (this.get(`route:${sid}`) as SessionRoute) ?? null;
  }

  async renewOrAdoptLease(code: string, ownerId: string, ttlMs: number): Promise<LeaseResult> {
    const key = `lease:${code}`;
    const cur = this.get(key) as { owner: string } | null;
    if (cur && cur.owner !== ownerId) return 'lost';
    this.set(key, { owner: ownerId }, ttlMs);
    return cur ? 'owned' : 'adopted';
  }

  async drainOutMany(sids: string[], max: number) {
    const out = new Map<string, ServerMsg[]>();
    for (const sid of sids) out.set(sid, await this.drainOut(sid, max));
    return out;
  }

  async getBlobs(codes: string[]) {
    const out = new Map<string, RoomBlob | null>();
    for (const code of codes) out.set(code, await this.getBlob(code));
    return out;
  }

  async dropSession(sid: string) {
    this.delete(`out:${sid}`);
  }
}

// ─── UpstashStore (Redis REST) ───────────────────────────────────────────

interface UpstashCmdResult {
  result: unknown;
  error?: string;
}

export class UpstashStore implements RealtimeStore {
  readonly mode = 'redis' as const;
  constructor(private url: string, private token: string) {}

  private async pipeline(cmds: unknown[][]): Promise<UpstashCmdResult[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds.map((c) => ({ cmd: c }))),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    return (await res.json()) as UpstashCmdResult[];
  }

  private async single(cmd: unknown[]): Promise<unknown> {
    const [r] = await this.pipeline([cmd]);
    return r?.result;
  }

  private static parse<T>(v: unknown): T | null {
    if (typeof v !== 'string') return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  async getBlob(code: string) {
    return UpstashStore.parse<RoomBlob>(await this.single(['GET', `jsa:blob:${code}`]));
  }

  async setBlob(code: string, blob: RoomBlob, ttlSec: number) {
    await this.pipeline([['SET', `jsa:blob:${code}`, JSON.stringify(blob), 'EX', String(ttlSec)]]);
  }

  async delBlob(code: string) {
    await this.pipeline([['DEL', `jsa:blob:${code}`]]);
  }

  async tryAdopt(code: string, ownerId: string, ttlMs: number) {
    const r = await this.single(['SET', `jsa:lease:${code}`, ownerId, 'PX', String(ttlMs), 'NX']);
    return r === 'OK';
  }

  async renewLease(code: string, ownerId: string, ttlMs: number) {
    const r = await this.single([
      'EVAL',
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
      '1',
      `jsa:lease:${code}`,
      ownerId,
      String(ttlMs),
    ]);
    return r === 1;
  }

  async releaseLease(code: string, ownerId: string) {
    await this.single([
      'EVAL',
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      '1',
      `jsa:lease:${code}`,
      ownerId,
    ]);
  }

  async pushInbox(code: string, item: InboxItem) {
    await this.pipeline([
      ['RPUSH', `jsa:inbox:${code}`, JSON.stringify(item)],
      ['LTRIM', `jsa:inbox:${code}`, '-600', '-1'],
      ['EXPIRE', `jsa:inbox:${code}`, '10'],
    ]);
  }

  async drainInbox(code: string, max: number) {
    const res = await this.pipeline([
      ['LRANGE', `jsa:inbox:${code}`, '0', String(max - 1)],
      ['LTRIM', `jsa:inbox:${code}`, String(max), '-1'],
      ['EXPIRE', `jsa:inbox:${code}`, '10'],
    ]);
    const items = UpstashStore.parse<InboxItem[]>(res[0]?.result) ?? [];
    return items;
  }

  async pushOut(sid: string, msg: ServerMsg) {
    await this.pipeline([
      ['RPUSH', `jsa:out:${sid}`, JSON.stringify(msg)],
      ['LTRIM', `jsa:out:${sid}`, '-200', '-1'],
      ['EXPIRE', `jsa:out:${sid}`, '30'],
    ]);
  }

  async drainOut(sid: string, max: number) {
    const res = await this.pipeline([
      ['LRANGE', `jsa:out:${sid}`, '0', String(max - 1)],
      ['LTRIM', `jsa:out:${sid}`, String(max), '-1'],
      ['EXPIRE', `jsa:out:${sid}`, '30'],
    ]);
    return UpstashStore.parse<ServerMsg[]>(res[0]?.result) ?? [];
  }

  async setTokenIndex(token: string, code: string) {
    await this.pipeline([['SET', `jsa:tok:${token}`, code, 'EX', '900']]);
  }

  async getTokenIndex(token: string) {
    const v = await this.single(['GET', `jsa:tok:${token}`]);
    return typeof v === 'string' ? v : null;
  }

  async setSessionRoute(sid: string, route: SessionRoute) {
    await this.pipeline([['SET', `jsa:sess:${sid}`, JSON.stringify(route), 'EX', '120']]);
  }

  async getSessionRoute(sid: string) {
    return UpstashStore.parse<SessionRoute>(await this.single(['GET', `jsa:sess:${sid}`]));
  }

  async renewOrAdoptLease(code: string, ownerId: string, ttlMs: number): Promise<LeaseResult> {
    // Atomic: renew when we own it, adopt when free/expired, lose otherwise.
    const r = await this.single([
      'EVAL',
      "local cur=redis.call('get',KEYS[1]) if cur==ARGV[1] then redis.call('pexpire',KEYS[1],ARGV[2]) return 1 end if (not cur) then redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[2]) return 2 end return 0",
      '1',
      `jsa:lease:${code}`,
      ownerId,
      String(ttlMs),
    ]);
    if (r === 1) return 'owned';
    if (r === 2) return 'adopted';
    return 'lost';
  }

  async drainOutMany(sids: string[], max: number) {
    const out = new Map<string, ServerMsg[]>();
    if (sids.length === 0) return out;
    const cmds: unknown[][] = [];
    for (const sid of sids) {
      cmds.push(
        ['LRANGE', `jsa:out:${sid}`, '0', String(max - 1)],
        ['LTRIM', `jsa:out:${sid}`, String(max), '-1'],
        ['EXPIRE', `jsa:out:${sid}`, '30'],
      );
    }
    const res = await this.pipeline(cmds);
    sids.forEach((sid, i) => {
      out.set(sid, UpstashStore.parse<ServerMsg[]>(res[i * 3]?.result) ?? []);
    });
    return out;
  }

  async getBlobs(codes: string[]) {
    const out = new Map<string, RoomBlob | null>();
    if (codes.length === 0) return out;
    const res = await this.pipeline([['MGET', ...codes.map((c) => `jsa:blob:${c}`)]]);
    const arr = (res[0]?.result as unknown[] | null) ?? null;
    codes.forEach((code, i) => out.set(code, UpstashStore.parse<RoomBlob>(arr?.[i] ?? null)));
    return out;
  }

  async dropSession(sid: string) {
    await this.pipeline([['DEL', `jsa:out:${sid}`]]);
  }
}

export function getStore(): RealtimeStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url.replace(/\/$/, ''), token);
  return new MemoryStore();
}
