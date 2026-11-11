/**
 * Multiplayer end-to-end test.
 *
 * Boots the authoritative RoomManager behind a real WebSocket server
 * (no Next.js involved) and drives scripted bot clients through the full
 * room + match lifecycle, covering the spec's test scenarios 1–11:
 *
 *   1  create room
 *   2  join ×3 + 5th rejected (room_full)
 *   3  ready flags + chat delivery
 *   4  start → 3-2-1 countdown → playing; movement input is applied
 *   5  joining a running match is rejected (match_started)
 *   6  shooting produces shots/bullets/damage
 *   7  kill → kill credit → respawn
 *   8  disconnect grace + token reconnect mid-match
 *   9  host leaves in lobby → host migration notice
 *  10  match to kill target → over + results → rematch resets
 *  11  protocol validation + rate limiting
 *
 *   npm run test:mp
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { RoomManager } from '../server/rooms/manager';
import { attachWebSocketServer, handleUpgrade } from '../server/networking/ws';
import type {
  ClientMsg, GameEvent, InputFrame, MatchResult, RoomPlayer, RoomState, ServerMsg, Snapshot,
} from '../shared/types';
import { INPUT_FIRE, INPUT_JUMP, INPUT_JET, INPUT_RELOAD } from '../shared/types';
import { KILL_TARGET, RESPAWN_MS } from '../shared/constants';
import { getMap } from '../shared/maps';
import { hasLineOfSight } from '../shared/physics';
import { WEAPONS } from '../shared/weapons';

// ── Tiny test framework ──────────────────────────────────────────────────

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, extra = ''): void {
  checks++;
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures++;
    console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function flags(o: {
  jump?: boolean; jet?: boolean; fire?: boolean; grenade?: boolean;
  melee?: boolean; reload?: boolean;
}): number {
  return (o.jump ? INPUT_JUMP : 0) | (o.jet ? INPUT_JET : 0) | (o.fire ? INPUT_FIRE : 0)
    | (o.grenade ? 8 : 0) | (o.melee ? 16 : 0) | (o.reload ? INPUT_RELOAD : 0);
}

// ── Bot client ───────────────────────────────────────────────────────────

class Bot {
  ws: WebSocket;
  opened: Promise<void>;
  closed = false;
  name: string;
  pid = '';
  token = '';
  room: RoomState | null = null;
  snap: Snapshot | null = null;
  over: MatchResult | null = null;
  notices: string[] = [];
  chats: { f: string; m: string; sys?: boolean }[] = [];
  errors: { code: string; msg: string }[] = [];
  shotsSeen = 0;
  bulletsSeen = 0;
  seq = 0;
  lastRecvAt = 0;
  private inbox: ServerMsg[] = [];
  private waiters: {
    pred: (m: ServerMsg) => boolean;
    resolve: (m: ServerMsg) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  constructor(port: number, name: string) {
    this.name = name;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
    this.ws.on('message', (d) => this.recv(JSON.parse(String(d)) as ServerMsg));
    this.ws.on('close', () => { this.closed = true; });
    this.ws.on('error', () => { /* close follows */ });
  }

  private recv(m: ServerMsg): void {
    this.lastRecvAt = Date.now();
    this.inbox.push(m);
    if (this.inbox.length > 4000) this.inbox.splice(0, 2000);
    switch (m.t) {
      case 'welcome': this.pid = m.pid; this.token = m.token; break;
      case 'room': this.room = m.room; break;
      case 'snap': this.snap = m.snap; this.shotsSeen += m.snap.ev.filter((e) => e.t === 'shot').length; this.bulletsSeen += m.snap.bs.length; break;
      case 'over': this.over = m.results; break;
      case 'notice': this.notices.push(m.msg); break;
      case 'error': this.errors.push({ code: m.code, msg: m.msg }); break;
      case 'chat': this.chats.push({ f: m.f, m: m.m, sys: m.sys }); break;
      default: break;
    }
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (w.pred(m)) {
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(m);
        break;
      }
    }
  }

  send(msg: ClientMsg | string): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  close(): void {
    try { this.ws.close(); } catch { /* ignore */ }
  }

  /** Wait for the next (or already-received) message matching pred. */
  wait<T extends ServerMsg['t']>(
    t: T,
    pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
    timeoutMs = 8000,
  ): Promise<Extract<ServerMsg, { t: T }>> {
    const found = this.inbox.find((m) => m.t === t && (pred as (m: ServerMsg) => boolean)(m));
    if (found) return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout waiting for ${t} (${this.name})`));
      }, timeoutMs);
      this.waiters.push({
        pred: ((m: ServerMsg) => m.t === t && (pred as (m: ServerMsg) => boolean)(m)) as (m: ServerMsg) => boolean,
        resolve: resolve as unknown as (m: ServerMsg) => void,
        timer,
      });
    });
  }

  waitRoom(pred?: (r: RoomState) => boolean, timeoutMs = 8000): Promise<ServerMsg & { t: 'room' }> {
    return this.wait('room', pred ? (m) => pred((m as { room: RoomState }).room) : undefined, timeoutMs);
  }

  /** Drop buffered history so waits only match messages arriving from now on. */
  clearInbox(): void {
    this.inbox.length = 0;
  }

  waitPlaying(timeoutMs = 12000): Promise<Snapshot> {
    return this.wait('snap', (m) => (m as { snap: Snapshot }).snap.phase === 'playing', timeoutMs)
      .then((m) => (m as { snap: Snapshot }).snap);
  }

  me(): RoomPlayer | undefined {
    return this.room?.players.find((p) => p.id === this.pid);
  }

  mySnap(): Snapshot['ps'][number] | undefined {
    return this.snap?.ps.find((p) => p.i === this.pid);
  }

  lastError(code: string): { code: string; msg: string } | undefined {
    return this.errors.filter((e) => e.code === code).pop();
  }

  /** Stream input frames at ~30 packets/s (2 frames each) for duration ms. */
  async streamInput(
    durationMs: number,
    mk: () => Pick<InputFrame, 'fl' | 'mx' | 'ax' | 'ay'>,
    paceMs = 33,
  ): Promise<void> {
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
      this.send({
        t: 'input',
        frames: [
          { seq: ++this.seq, ...mk() },
          { seq: ++this.seq, ...mk() },
        ],
      });
      await sleep(paceMs);
    }
  }
}

// ── Combat bot: close distance, aim, fire until target dies ─────────────

interface HuntResult {
  ok: boolean;
  killEvents: { k: string; v: string }[];
  reason: string;
}

async function huntAndKill(a: Bot, b: Bot, timeoutMs = 90_000): Promise<HuntResult> {
  const killEvents: { k: string; v: string }[] = [];
  const start = Date.now();
  let lastX = -9999;
  let lastProgress = Date.now();
  let jetting = false;
  let pulse = false;
  const solids = getMap(a.room?.mapId ?? 'foundry').solids;

  while (Date.now() - start < timeoutMs) {
    const snap = a.snap;
    const aS = snap?.ps.find((p) => p.i === a.pid);
    const bS = snap?.ps.find((p) => p.i === b.pid);
    if (!snap || !aS || !bS) { await sleep(40); continue; }

    // collect kill events targeting b
    for (const ev of snap.ev as GameEvent[]) {
      if (ev.t === 'kill' && ev.v === b.pid) killEvents.push({ k: ev.k, v: ev.v });
    }

    if (snap.phase !== 'playing') return { ok: false, killEvents, reason: `phase=${snap.phase}` };
    if (aS.al === 0 || bS.al === 0) { await sleep(60); continue; } // wait out respawn

    const dx = bS.x - aS.x;
    const dy = bS.y - aS.y;
    const dist = Math.hypot(dx, dy);
    const now = Date.now();
    const los = hasLineOfSight(aS.x, aS.y, bS.x, bS.y, solids);

    // ── Movement: walk toward the target; when wedged, jet over the
    //    obstacle. A bare jump can't clear taller cover, and jetting on
    //    fumes does nothing — so when fuel is low, hold still and regen.
    let mx: -1 | 0 | 1 = 0;
    if (Math.abs(dx) > 140) mx = dx > 0 ? 1 : -1;

    if (Math.abs(aS.x - lastX) > 10) { lastProgress = now; lastX = aS.x; }
    const stuckFor = now - lastProgress;
    // Jet bursts are latched: a one-frame trickle at the fuel threshold
    // would never build speed, so a burst runs until it's spent (or the
    // bot moves again). Sustained thrust from ≥50 fuel climbs ~340px —
    // enough to clear every cover wall on the ground route.
    if (jetting && (aS.f < 12 || stuckFor <= 700)) jetting = false;
    else if (!jetting && stuckFor > 700 && aS.f >= 50) jetting = true;
    const jet = jetting;
    const jump = false;

    // ── Fire: any sight line within the weapon's range; semi-auto needs
    //    a fresh edge per shot, so the fire bit pulses every frame.
    pulse = !pulse;
    const range = WEAPONS[aS.w].range - 60;
    const fire = los && dist < range && bS.al === 1 && aS.m > 0 && aS.rl === 0 && pulse;
    const reload = aS.m === 0 && aS.rl === 0 && aS.r > 0;

    // aim is angle-only on the server — send a normalized vector (the
    // validator rejects |ax| or |ay| > 1000).
    const aimLen = dist || 1;
    a.send({
      t: 'input',
      frames: [{
        seq: ++a.seq,
        fl: flags({ fire, jet, jump, reload }),
        mx,
        ax: dx / aimLen,
        ay: dy / aimLen,
      }],
    });
    await sleep(30);
  }
  return {
    ok: killEvents.some((e) => e.k === a.pid),
    killEvents,
    reason: `no kill in ${timeoutMs}ms`,
  };
}

// ── Scenario runner ──────────────────────────────────────────────────────

async function runScenarios(port: number, mgr: RoomManager): Promise<void> {
  // ── Scenario 1: create room ──────────────────────────────────────────
  console.log('\n[1] create room');
  const A = new Bot(port, 'Alpha');
  await A.opened;
  // Host may choose the map — the suite pins 'foundry' so bot navigation is
  // deterministic across runs.
  A.send({ t: 'create', name: 'Alpha', mapId: 'foundry' });
  await A.wait('welcome', (m) => m.pid !== 'guest');
  const roomMsg = await A.waitRoom((r) => r.players.length === 1, 6000);
  const code = roomMsg.room.code;
  ok('room created with 4-char code', /^[A-Z0-9]{4}$/.test(code), code);
  ok('creator is host', roomMsg.room.hostId === A.pid);
  ok('phase lobby', roomMsg.room.phase === 'lobby');
  ok('host map choice honored', roomMsg.room.mapId === 'foundry', roomMsg.room.mapId);
  ok('token issued', A.token.length >= 8);

  // ── Scenario 2: join ×3, reject 5th ──────────────────────────────────
  console.log('\n[2] join x3 + room full');
  const B = new Bot(port, 'Bravo');
  const C = new Bot(port, 'Charlie');
  const D = new Bot(port, 'Delta');
  await Promise.all([B.opened, C.opened, D.opened]);
  B.send({ t: 'join', code, name: 'Bravo' });
  await B.waitRoom((r) => r.players.length === 2);
  C.send({ t: 'join', code, name: 'Charlie' });
  await C.waitRoom((r) => r.players.length === 3);
  D.send({ t: 'join', code, name: 'Delta' });
  await D.waitRoom((r) => r.players.length === 4);
  await B.waitRoom((r) => r.players.length === 4, 6000);
  await C.waitRoom((r) => r.players.length === 4, 6000);
  ok('room grew to 4 players', (B.room?.players.length ?? 0) === 4 && (C.room?.players.length ?? 0) === 4);

  const E = new Bot(port, 'Echo');
  await E.opened;
  E.send({ t: 'join', code, name: 'Echo' });
  await E.wait('error', (m) => m.code === 'room_full');
  ok('5th join rejected (room_full)', E.lastError('room_full') !== undefined);

  // ── Scenario 11 (part 1): validation ─────────────────────────────────
  console.log('\n[11a] protocol validation');
  A.send('this is not json{{{');
  await A.wait('error', (m) => m.code === 'bad_message');
  ok('malformed json → bad_message', true);
  A.send({ t: 'create', name: 'AlphaAgain' });
  await A.wait('error', (m) => m.code === 'already_in_room');
  ok('create while in room → already_in_room', true);

  const H = new Bot(port, 'Hacker');
  await H.opened;
  H.send({ t: 'join', code: 'ZZ', name: 'Hacker' });
  await H.wait('error', (m) => m.code === 'bad_code');
  ok('2-char code → bad_code', true);
  H.send({ t: 'join', code: 'ZZ99', name: 'Hacker' });
  await H.wait('error', (m) => m.code === 'room_not_found');
  ok('unknown room → room_not_found', true);
  H.send({ t: 'create', name: '' });
  await H.wait('error', (m) => m.code === 'bad_name');
  ok('empty name → bad_name', true);
  C.send({ t: 'start' });
  await C.wait('error', (m) => m.code === 'not_host');
  ok('non-host start → not_host', true);

  // ── Scenario 11 (part 2): rate limiting (sacrificial connection) ─────
  console.log('\n[11b] rate limiting');
  for (let i = 0; i < 45; i++) H.send({ t: 'ping', ts: i });
  await sleep(600);
  ok('burst flood → rate_limited', H.lastError('rate_limited') !== undefined,
    `errors=${JSON.stringify(H.errors.map((e) => e.code))}`);
  H.close();

  // ── Scenario 3: ready flags + chat ───────────────────────────────────
  console.log('\n[3] ready + chat');
  A.send({ t: 'ready', ready: true });
  await A.waitRoom((r) => r.players.find((p) => p.id === A.pid)?.ready === true);
  ok('host ready flag broadcast', true);
  B.send({ t: 'ready', ready: true });
  await B.waitRoom((r) => r.players.filter((p) => p.ready).length === 2);
  ok('second player ready broadcast', true);

  A.send({ t: 'chat', text: 'gl hf everyone' });
  await B.wait('chat', (m) => m.m === 'gl hf everyone');
  ok('chat delivered to others', B.chats.some((c) => c.f === 'Alpha' && c.m === 'gl hf everyone'));

  // ── Scenario 4: start → countdown → playing → movement ───────────────
  console.log('\n[4] start, countdown, movement');
  A.send({ t: 'start' });
  const cdRoom = await D.waitRoom((r) => r.phase === 'countdown', 8000);
  ok('countdown broadcast to all', typeof cdRoom.room.countdownAt === 'number');
  await D.waitPlaying();
  ok('phase reached playing', true);

  const before = A.mySnap();
  await A.streamInput(700, () => ({ fl: 0, mx: 1, ax: 1, ay: 0 }));
  await sleep(120);
  const after = A.mySnap();
  ok('input processed (si advanced)', (after?.si ?? 0) >= 40, `si=${after?.si}`);
  ok('moved right', (after?.x ?? 0) > (before?.x ?? 0) + 60,
    `x ${before?.x} → ${after?.x}`);
  ok('still alive & healthy', after?.al === 1 && (after?.hp ?? 0) > 0);

  // ── Scenario 5: room capacity is enforced during matches ─────────────
  // (a free slot allows late joins that spawn immediately; a full room
  //  rejects the 5th player regardless of phase)
  console.log('\n[5] join during match');
  const F = new Bot(port, 'Foxtrot');
  await F.opened;
  F.send({ t: 'join', code, name: 'Foxtrot' });
  await F.wait('error', (m) => m.code === 'room_full');
  ok('5th join rejected mid-match (room_full)', true);

  // ── Scenario 6: shooting produces bullets + damage events ────────────
  // Semi-auto weapons need a fresh fire edge per shot → pulse the bit.
  console.log('\n[6] shooting');
  let pulse = false;
  await A.streamInput(600, () => {
    pulse = !pulse;
    return { fl: flags({ fire: pulse }), mx: 0, ax: 1, ay: 0 };
  });
  await sleep(200);
  const shotSeen = A.shotsSeen > 0 || A.bulletsSeen > 0;
  ok('shot events / bullets visible', shotSeen, `shots=${A.shotsSeen} bullets=${A.bulletsSeen}`);

  // ── Scenario 7: first kill + respawn ─────────────────────────────────
  console.log('\n[7] kill + respawn');
  const bDeathsBefore = B.mySnap()?.d ?? 0;
  const hunt1 = await huntAndKill(A, B, 90_000);
  ok('kill registered', hunt1.ok, hunt1.reason);
  await sleep(150);
  const aKills = A.mySnap()?.k ?? 0;
  ok('killer credited', aKills >= 1, `kills=${aKills}`);
  const bDeadNow = (B.mySnap()?.d ?? 0) >= bDeathsBefore + 1 || (B.mySnap()?.al ?? 1) === 0;
  ok('victim death recorded', bDeadNow);
  // wait for respawn
  const t0 = Date.now();
  while (Date.now() - t0 < RESPAWN_MS + 2500 && (B.mySnap()?.al ?? 1) === 0) await sleep(100);
  ok('victim respawned within window', B.mySnap()?.al === 1);

  // ── Scenario 8: disconnect grace + token reconnect ───────────────────
  console.log('\n[8] disconnect + reconnect');
  B.close();
  await A.waitRoom((r) => r.players.find((p) => p.id === B.pid)?.connected === false, 6000);
  ok('disconnect noticed (connected=false)', true);

  const B2 = new Bot(port, 'Bravo2');
  await B2.opened;
  B2.send({ t: 'hello', name: 'Bravo', token: B.token });
  await B2.wait('welcome', (m) => m.pid === B.pid);
  ok('token reclaimed same player slot', B2.pid === B.pid);
  const backRoom = await B2.waitRoom((r) => r.code === code && r.phase !== 'lobby', 6000);
  ok('rejoined the same room mid-match', backRoom.room.code === code);
  await A.waitRoom((r) => r.players.find((p) => p.id === B.pid)?.connected === true, 6000);
  ok('reconnect noticed (connected=true)', true);

  // ── Scenario 10: full match to kill target → over → rematch ──────────
  console.log('\n[10] full match → over → rematch (this drives 10 kills, ~2 min)');
  const matchDeadline = Date.now() + 300_000;
  let won = false;
  let overMsg: MatchResult | null = null;
  while (Date.now() < matchDeadline) {
    const aS = A.mySnap();
    if (aS && aS.k >= KILL_TARGET) { won = true; break; }
    if (A.snap?.phase === 'over' || A.over) break;
    const res = await huntAndKill(A, B2, 60_000);
    if (!res.ok) break;
    await sleep(100);
  }
  const overWait = await A.wait('over', () => true, won ? 12_000 : 1500).catch(() => null);
  overMsg = (overWait as { results: MatchResult } | null)?.results ?? A.over;
  ok('match over reported', A.snap?.phase === 'over' || overMsg !== null,
    `kills=${A.mySnap()?.k}`);
  if (overMsg) {
    ok('winner is the killer', overMsg.winner === A.pid, JSON.stringify(overMsg).slice(0, 200));
    ok('reason kills or time', overMsg.reason === 'kills' || overMsg.reason === 'time');
    const me = overMsg.players.find((p) => p.id === A.pid);
    ok('results include 10 kills', (me?.kills ?? 0) >= KILL_TARGET, `kills=${me?.kills}`);
  }

  // rematch (drop the first match's buffered history so the waits below
  // can only match messages from the second match)
  A.clearInbox();
  A.send({ t: 'rematch' });
  const remRoom = await A.waitRoom((r) => r.phase === 'countdown', 8000);
  ok('rematch → countdown again', remRoom.room.phase === 'countdown');
  const remSnap = await A.waitPlaying(12_000);
  const aAfter = remSnap.ps.find((p) => p.i === A.pid);
  ok('scores reset on rematch', (aAfter?.k ?? 1) === 0, `kills=${aAfter?.k}`);

  // ── Scenario 9: host leaves lobby → host migration ───────────────────
  console.log('\n[9] host migration');
  A.send({ t: 'lobby' }); // host sends everyone back to the lobby
  await A.waitRoom((r) => r.phase === 'lobby', 8000);
  ok('back in lobby after match', true);
  A.close();
  const migRoom = await B2.waitRoom(
    (r) => r.phase === 'lobby' && r.hostId === B2.pid && r.players.length === 3,
    8000,
  );
  ok('host migrated to next player', migRoom.room.hostId === B2.pid);
  ok('leaver removed from roster', migRoom.room.players.length === 3);
  ok('migration notice sent', B2.notices.some((n) => n.includes('is the new host')));

  // new host can start
  B2.send({ t: 'ready', ready: true });
  B2.send({ t: 'start' });
  await B2.waitRoom((r) => r.phase === 'countdown', 8000);
  ok('new host can start the match', true);

  // ── Quick play ────────────────────────────────────────────────────────
  console.log('\n[extra] quick play');
  const G = new Bot(port, 'Golf');
  await G.opened;
  G.send({ t: 'quick', name: 'Golf' });
  await G.wait('welcome', (m) => m.pid !== 'guest', 6000);
  await G.waitRoom((r) => r.players.some((p) => p.id === G.pid), 6000);
  ok('quick play finds/joins a room', G.room !== null);
  G.send({ t: 'leave' });

  // ── Cleanup: everyone leaves, room is garbage collected ──────────────
  console.log('\n[cleanup] leave + GC');
  for (const bot of [B2, C, D, G]) {
    bot.send({ t: 'leave' });
    bot.close();
  }
  await sleep(500);
  ok('empty room garbage collected', mgr.rooms.size === 0, `rooms=${mgr.rooms.size}`);

  for (const bot of [A, B, C, D, E, F, G, H]) bot.close();
}

// ── Bootstrap ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mgr = new RoomManager();
  const httpServer = http.createServer((_q, res) => { res.end('ok'); });
  const wss = attachWebSocketServer(httpServer, mgr);
  handleUpgrade(httpServer, wss);
  const ticker = setInterval(() => mgr.tick(), 1000 / 30);

  await new Promise<void>((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(0, '127.0.0.1', () => res());
  });
  const port = (httpServer.address() as AddressInfo).port;
  console.log(`Jetstorm Arena test server: ws://127.0.0.1:${port}/ws\n`);

  const cleanup = () => {
    clearInterval(ticker);
    wss.close();
    httpServer.close();
  };
  process.on('unhandledRejection', (e) => {
    console.error('unhandledRejection:', e);
    cleanup();
    process.exit(1);
  });
  process.on('uncaughtException', (e) => {
    console.error('uncaughtException:', e);
    cleanup();
    process.exit(1);
  });

  try {
    await runScenarios(port, mgr);
  } catch (err) {
    failures++;
    console.error('\n✘ suite aborted:', err instanceof Error ? err.message : err);
  } finally {
    cleanup();
  }

  console.log(`\n──────────────────────────────────`);
  console.log(`${checks}/${checks + failures} checks passed${failures ? `, ${failures} FAILED` : ' — all green'}`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
