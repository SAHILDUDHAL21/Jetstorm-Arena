/**
 * Authoritative match simulation. Runs at 30 Hz on the server; the client
 * NEVER decides damage, kills, ammo, or movement. All inputs are validated
 * upstream (server/validation) and rate-limited before they reach here.
 *
 * Tick order (spec §46):
 *   inputs → movement/gravity → collisions → bullets → damage → deaths →
 *   respawns → pickups → scores → match end → broadcast (Room).
 */
import * as C from '../../shared/constants';
import { getMap } from '../../shared/maps';
import type { Rect, MapDef } from '../../shared/maps';
import { WEAPONS, WEAPON_IDS } from '../../shared/weapons';
import type { WeaponId, GameEvent, Snapshot, PlayerSnap, MatchResult, RoomPhase } from '../../shared/types';
import { INPUT_FIRE, INPUT_GRENADE, INPUT_JET, INPUT_JUMP, INPUT_MELEE, INPUT_RELOAD } from '../../shared/types';
import {
  stepPlayer, stepBall, freshMoveState, hasLineOfSight, pickSpawn, clamp,
  type Body, type MoveState,
} from '../../shared/physics';

export interface SimPlayer {
  id: string;
  name: string;
  ms: MoveState;
  aim: number; // radians
  mx: -1 | 0 | 1;
  jump: boolean;
  jet: boolean;
  fire: boolean;
  prevFire: boolean;
  hp: number;
  alive: boolean;
  respawnAt: number;
  weapon: WeaponId;
  owned: Set<WeaponId>;
  mag: number;
  reserve: number;
  grenades: number;
  kills: number;
  deaths: number;
  lastShotAt: number;
  reloadEndAt: number;
  switchAt: number;
  meleeReadyAt: number;
  lastSeq: number;
  queue: { seq: number; fl: number; mx: -1 | 0 | 1; ax: number; ay: number }[];
  connected: boolean;
}

interface SimBullet {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: WeaponId;
  dist: number;
  dead: boolean;
}

interface SimGrenade {
  id: number;
  owner: string;
  body: Body;
  fuse: number;
  dead: boolean;
}

export interface SimPickup {
  id: number;
  spot: { x: number; y: number; kind: 'health' | 'ammo' | 'weapon'; weapon?: string };
  active: boolean;
  respawnAt: number;
}

export interface SimEvents {
  events: GameEvent[];
}

export class MatchSim {
  map: MapDef;
  solids: Rect[];
  players = new Map<string, SimPlayer>();
  bullets: SimBullet[] = [];
  grenades: SimGrenade[] = [];
  pickups: SimPickup[] = [];
  events: GameEvent[] = [];
  tick = 0;
  phase: RoomPhase = 'lobby';
  matchEndsAt = 0;
  goAt = 0;
  overReason: 'kills' | 'time' | null = null;
  winner: string | null = null;
  private nextBulletId = 1;
  private nextGrenadeId = 1;
  private nextPickupId = 1;

  constructor(mapId: string) {
    this.map = getMap(mapId);
    this.solids = this.map.solids;
    this.resetPickups();
  }

  private resetPickups() {
    this.pickups = this.map.pickups.map((spot) => ({
      id: this.nextPickupId++,
      spot,
      active: true,
      respawnAt: 0,
    }));
  }

  // ── Player lifecycle ───────────────────────────────────────────────────

  addPlayer(id: string, name: string, now: number): SimPlayer {
    const spawn = pickSpawn(this.map.spawns, [...this.players.values()].map((p) => ({ ...p.ms.body, alive: p.alive })), Math.random());
    const p: SimPlayer = {
      id,
      name,
      ms: freshMoveState(spawn.x, spawn.y - C.PLAYER_H / 2),
      aim: spawn.x < this.map.w / 2 ? 0 : Math.PI,
      mx: 0, jump: false, jet: false, fire: false, prevFire: false,
      hp: C.HEALTH_MAX,
      alive: true,
      respawnAt: 0,
      weapon: 'pistol',
      owned: new Set<WeaponId>(['pistol']),
      mag: WEAPONS.pistol.magazineSize,
      reserve: WEAPONS.pistol.ammoReserve,
      grenades: C.GRENADE_COUNT_START,
      kills: 0,
      deaths: 0,
      lastShotAt: 0,
      reloadEndAt: 0,
      switchAt: 0,
      meleeReadyAt: 0,
      lastSeq: 0,
      queue: [],
      connected: true,
    };
    this.players.set(id, p);
    if (this.phase === 'playing') {
      this.events.push({ t: 'spawn', i: id, x: p.ms.body.x, y: p.ms.body.y });
    }
    return p;
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  queueInput(id: string, frames: { seq: number; fl: number; mx: -1 | 0 | 1; ax: number; ay: number }[]) {
    const p = this.players.get(id);
    if (!p) return;
    for (const f of frames) {
      if (f.seq <= p.lastSeq) continue; // stale / duplicate
      if (p.queue.length > 30) p.queue.shift(); // drop oldest under flood
      p.queue.push(f);
    }
  }

  /** Respawn-position + restore everything (fresh match or death respawn). */
  private respawnPlayer(p: SimPlayer, now: number) {
    const enemies: { x: number; y: number; alive: boolean }[] = [];
    for (const o of this.players.values()) {
      if (o.id !== p.id) enemies.push({ ...o.ms.body, alive: o.alive });
    }
    const s = pickSpawn(this.map.spawns, enemies, Math.random());
    p.ms = freshMoveState(s.x, s.y - C.PLAYER_H / 2);
    p.hp = C.HEALTH_MAX;
    p.alive = true;
    p.weapon = 'pistol';
    p.owned = new Set<WeaponId>(['pistol']);
    p.mag = WEAPONS.pistol.magazineSize;
    p.reserve = WEAPONS.pistol.ammoReserve;
    p.grenades = C.GRENADE_COUNT_START;
    p.lastShotAt = 0;
    p.reloadEndAt = 0;
    p.switchAt = 0;
    p.queue.length = 0;
    p.prevFire = false;
    this.events.push({ t: 'spawn', i: p.id, x: p.ms.body.x, y: p.ms.body.y });
    void now;
  }

  // ── Match lifecycle ────────────────────────────────────────────────────

  startMatch(now: number) {
    this.phase = 'countdown';
    this.goAt = now + C.COUNTDOWN_MS;
    this.matchEndsAt = 0;
    this.overReason = null;
    this.winner = null;
    this.bullets = [];
    this.grenades = [];
    this.resetPickups();
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      this.respawnPlayer(p, now);
    }
    this.events.push({ t: 'sys', m: 'Match starting' });
  }

  rematch(now: number) {
    this.startMatch(now);
  }

  private endMatch(reason: 'kills' | 'time', now: number) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.overReason = reason;
    const results = this.results();
    this.winner = results.winner;
    this.events.push({ t: 'over', winner: this.winner });
    void now;
  }

  results(): MatchResult {
    const players = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
    const top = players[0];
    const winner = top && (top.kills > 0 || players.every((p) => p.kills === top.kills && p.deaths === top.deaths))
      ? top.id
      : null;
    if (top && top.kills === 0) {
      const allZero = players.every((p) => p.kills === 0);
      if (allZero) return { players, winner: null, reason: this.overReason ?? 'time' };
    }
    return { players, winner, reason: this.overReason ?? 'time' };
  }

  backToLobby() {
    this.phase = 'lobby';
    this.bullets = [];
    this.grenades = [];
  }

  // ── Main tick (30 Hz) ──────────────────────────────────────────────────

  update(now: number) {
    this.tick++;

    if (this.phase === 'countdown') {
      // allow aim only
      for (const p of this.players.values()) {
        this.processFrameAimOnly(p);
      }
      if (now >= this.goAt) {
        this.phase = 'playing';
        this.matchEndsAt = now + C.TIME_LIMIT_MS;
        this.events.push({ t: 'sys', m: 'GO' });
      }
      return;
    }
    if (this.phase === 'over') return;
    if (this.phase !== 'playing') return;

    // 1–4. Inputs → movement (each frame advances INPUT_DT at 60 Hz)
    for (const p of this.players.values()) {
      this.processInputQueue(p, now);
    }

    // 6–8. Bullets, grenades, damage
    this.updateBullets(now, C.TICK_MS / 1000);
    this.updateGrenades(now, C.TICK_MS / 1000);

    // 9–10. Deaths → respawns
    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt) {
        this.respawnPlayer(p, now);
      }
    }

    // 11. Pickups
    this.updatePickups(now);

    // 12–13. Scores + match end
    if (this.matchEndsAt && now >= this.matchEndsAt) {
      this.endMatch('time', now);
    }
  }

  private processFrameAimOnly(p: SimPlayer) {
    const f = p.queue.shift();
    if (!f) return;
    p.lastSeq = f.seq;
    const len = Math.sqrt(f.ax * f.ax + f.ay * f.ay);
    if (len > 0.01) p.aim = Math.atan2(f.ay, f.ax);
  }

  private processInputQueue(p: SimPlayer, now: number) {
    let guard = 0;
    while (p.queue.length > 0 && guard++ < 12) {
      const f = p.queue.shift()!;
      p.lastSeq = f.seq;
      const len = Math.sqrt(f.ax * f.ax + f.ay * f.ay);
      if (len > 0.01) p.aim = Math.atan2(f.ay, f.ax);
      p.mx = f.mx;
      p.prevFire = p.fire;
      p.fire = (f.fl & INPUT_FIRE) !== 0;
      p.jump = (f.fl & INPUT_JUMP) !== 0;
      p.jet = (f.fl & INPUT_JET) !== 0;

      if (!p.alive) continue;

      stepPlayer(p.ms, { mx: p.mx, jump: p.jump, jet: p.jet }, this.solids, now, C.INPUT_DT);

      // Edges: action bits are asserted on exactly one input frame per press.
      if (f.fl & INPUT_GRENADE) this.throwGrenade(p, now);
      if (f.fl & INPUT_MELEE) this.doMelee(p, now);
      if (f.fl & INPUT_RELOAD) this.tryReload(p, now);

      // Shooting (rate/ammo/reload state validated here)
      if (p.fire) this.tryFire(p, now, C.INPUT_DT);

      // Reload completion
      if (p.reloadEndAt && now >= p.reloadEndAt) {
        const def = WEAPONS[p.weapon];
        const need = def.magazineSize - p.mag;
        const take = Math.min(need, p.reserve);
        p.mag += take;
        p.reserve -= take;
        p.reloadEndAt = 0;
      }
    }
  }

  // ── Combat primitives ──────────────────────────────────────────────────

  private tryFire(p: SimPlayer, now: number, dt: number) {
    const def = WEAPONS[p.weapon];
    const semi = !def.auto;
    if (semi && p.prevFire) return;
    if (now < p.lastShotAt + def.fireRateMs) return;
    if (now < p.switchAt) return;
    if (p.reloadEndAt) return;
    if (p.mag <= 0) {
      this.tryReload(p, now); // auto-reload on empty
      return;
    }
    p.lastShotAt = now;
    p.mag--;

    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    const muzzleX = p.ms.body.x + cos * 18;
    const muzzleY = p.ms.body.y + sin * 18 + 4;
    const shots = def.pellets;
    for (let i = 0; i < shots; i++) {
      const spread = shots > 1 ? (Math.random() - 0.5) * def.spread : (Math.random() - 0.5) * def.spread;
      const a = p.aim + spread;
      this.bullets.push({
        id: this.nextBulletId++,
        owner: p.id,
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(a) * def.bulletSpeed,
        vy: Math.sin(a) * def.bulletSpeed,
        weapon: p.weapon,
        dist: 0,
        dead: false,
      });
    }
    if (this.bullets.length > 96) this.bullets.splice(0, this.bullets.length - 96);
    this.events.push({ t: 'shot', i: p.id, x: muzzleX, y: muzzleY, a: p.aim, w: p.weapon });
    void dt;
  }

  tryReload(p: SimPlayer, now: number) {
    if (!p.alive || p.reloadEndAt) return;
    const def = WEAPONS[p.weapon];
    if (p.mag >= def.magazineSize || p.reserve <= 0) return;
    p.reloadEndAt = now + def.reloadMs;
    this.events.push({ t: 'reload', i: p.id });
  }

  switchWeapon(p: SimPlayer, w: WeaponId, now: number): boolean {
    if (!p.owned.has(w) || !p.alive) return false;
    if (p.weapon === w) return true;
    p.weapon = w;
    p.switchAt = now + C.SWITCH_COOLDOWN_MS;
    p.reloadEndAt = 0; // switching cancels reload
    return true;
  }

  private throwGrenade(p: SimPlayer, now: number) {
    if (!p.alive || p.grenades <= 0 || this.phase !== 'playing') return;
    p.grenades--;
    const vx = Math.cos(p.aim) * C.GRENADE_SPEED + p.ms.body.vx * 0.4;
    const vy = Math.sin(p.aim) * C.GRENADE_SPEED + p.ms.body.vy * 0.25 - 60;
    this.grenades.push({
      id: this.nextGrenadeId++,
      owner: p.id,
      body: { x: p.ms.body.x + Math.cos(p.aim) * 16, y: p.ms.body.y + Math.sin(p.aim) * 16, vx, vy },
      fuse: C.GRENADE_FUSE_MS,
      dead: false,
    });
    this.events.push({ t: 'nade', i: p.id, x: p.ms.body.x, y: p.ms.body.y, a: p.aim });
  }

  private doMelee(p: SimPlayer, now: number) {
    if (!p.alive || now < p.meleeReadyAt || this.phase !== 'playing') return;
    p.meleeReadyAt = now + C.MELEE_COOLDOWN_MS;
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    const hx = p.ms.body.x + cos * (C.MELEE_RANGE * 0.6);
    const hy = p.ms.body.y + sin * (C.MELEE_RANGE * 0.6);
    this.events.push({ t: 'melee', i: p.id, x: hx, y: hy, a: p.aim });
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive) continue;
      const dx = o.ms.body.x - p.ms.body.x;
      const dy = o.ms.body.y - p.ms.body.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > C.MELEE_RANGE + C.PLAYER_W / 2) continue;
      const dot = d > 1 ? (dx * cos + dy * sin) / d : 1;
      if (dot < C.MELEE_ARC_DOT) continue;
      o.ms.body.vx += cos * C.MELEE_KNOCKBACK;
      o.ms.body.vy += sin * C.MELEE_KNOCKBACK * 0.4 - 120;
      this.applyDamage(o, C.MELEE_DAMAGE, p.id, 'melee', o.ms.body.x, o.ms.body.y, now);
    }
  }

  private updateBullets(now: number, dt: number) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      const def = WEAPONS[b.weapon];
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const stepLen = speed * dt;
      const steps = Math.max(1, Math.ceil(stepLen / C.BULLET_STEP_PX));
      const sx = (b.vx * dt) / steps;
      const sy = (b.vy * dt) / steps;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += sx;
        b.y += sy;
        b.dist += Math.sqrt(sx * sx + sy * sy);
        // solids
        for (const r of this.solids) {
          if (b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h) {
            if (def.rocket) {
              this.explode(b.owner, b.x, b.y, C.ROCKET_RADIUS, C.ROCKET_DAMAGE_MAX, b.owner, now, true);
            } else {
              this.events.push({ t: 'imp', x: b.x, y: b.y, a: Math.atan2(b.vy, b.vx) });
            }
            b.dead = true;
            break;
          }
        }
        if (b.dead) break;
        // players
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner) continue;
          const pl = p.ms.body;
          if (
            b.x >= pl.x - C.PLAYER_W / 2 - 2 && b.x <= pl.x + C.PLAYER_W / 2 + 2 &&
            b.y >= pl.y - C.PLAYER_H / 2 - 2 && b.y <= pl.y + C.PLAYER_H / 2 + 2
          ) {
            if (def.rocket) {
              this.explode(b.owner, b.x, b.y, C.ROCKET_RADIUS, C.ROCKET_DAMAGE_MAX, b.owner, now, true);
              this.applyDamage(p, C.ROCKET_DAMAGE_DIRECT, b.owner, 'rocket', b.x, b.y, now);
            } else {
              const kb = 70 + def.weight * 150;
              p.ms.body.vx += (b.vx / speed) * kb;
              p.ms.body.vy += (b.vy / speed) * kb * 0.5 - 30;
              this.applyDamage(p, def.damage, b.owner, b.weapon, b.x, b.y, now);
            }
            b.dead = true;
            break;
          }
        }
      }
      if (!b.dead && b.dist > def.range) b.dead = true;
      if (!b.dead) {
        // world bounds catch-all
        if (b.x < 0 || b.x > this.map.w || b.y < 0 || b.y > this.map.h) b.dead = true;
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
    if (this.bullets.length > 96) this.bullets.splice(0, this.bullets.length - 96);
  }

  private updateGrenades(now: number, dt: number) {
    for (const g of this.grenades) {
      if (g.dead) continue;
      g.fuse -= dt * 1000;
      stepBall(g.body, this.solids, dt, C.GRAVITY * 0.9, C.GRENADE_BOUNCE, C.GRENADE_FRICTION, 7);
      if (g.fuse <= 0) {
        g.dead = true;
        this.explode(g.owner, g.body.x, g.body.y, C.GRENADE_RADIUS, C.GRENADE_DAMAGE_MAX, g.owner, now, false);
      }
    }
    this.grenades = this.grenades.filter((g) => !g.dead);
  }

  private explode(
    killerId: string,
    x: number,
    y: number,
    radius: number,
    dmgMax: number,
    owner: string,
    now: number,
    big: boolean,
  ) {
    this.events.push({ t: 'boom', x, y, r: radius, big });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const dx = p.ms.body.x - x;
      const dy = p.ms.body.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius + C.PLAYER_W / 2) continue;
      if (!hasLineOfSight(x, y, p.ms.body.x, p.ms.body.y, this.solids)) continue;
      const t = clamp(d / radius, 0, 1);
      const dmg = Math.round(dmgMax + (C.GRENADE_DAMAGE_MIN - dmgMax) * t);
      const kb = (1 - t) * 560 + 120;
      const inv = d > 1 ? 1 / d : 0;
      p.ms.body.vx += dx * inv * kb;
      p.ms.body.vy += dy * inv * kb - 160;
      this.applyDamage(p, dmg, killerId, owner === p.id && killerId === p.id ? 'grenade' : 'grenade', x, y, now);
    }
  }

  private applyDamage(
    target: SimPlayer,
    amount: number,
    killerId: string | null,
    weapon: WeaponId | 'grenade' | 'melee' | 'rocket',
    hx: number,
    hy: number,
    now: number,
  ) {
    if (!target.alive || this.phase !== 'playing') return;
    const dmg = Math.max(1, Math.round(amount));
    target.hp = Math.max(0, target.hp - dmg);
    this.events.push({ t: 'hit', i: target.id, x: hx, y: hy, dmg, by: killerId ?? undefined });
    if (target.hp <= 0) {
      target.alive = false;
      target.deaths++;
      target.respawnAt = now + C.RESPAWN_MS;
      const killer = killerId ? this.players.get(killerId) : undefined;
      const credit: WeaponId | 'grenade' | 'melee' | 'rocket' = weapon;
      if (killer && killer.id !== target.id) {
        killer.kills++;
        if (killer.kills >= C.KILL_TARGET) {
          this.endMatch('kills', now);
        }
      }
      this.events.push({
        t: 'kill',
        k: killer && killer.id !== target.id ? killer.id : '',
        v: target.id,
        w: credit as WeaponId | 'grenade' | 'melee' | 'void',
      });
    }
  }

  private updatePickups(now: number) {
    for (const pk of this.pickups) {
      if (!pk.active) {
        if (now >= pk.respawnAt) pk.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const b = p.ms.body;
        if (
          Math.abs(b.x - pk.spot.x) <= C.PICKUP_R + C.PLAYER_W / 2 &&
          Math.abs(b.y - pk.spot.y) <= C.PICKUP_R + C.PLAYER_H / 2
        ) {
          const taken = this.collect(p, pk, now);
          if (taken) {
            pk.active = false;
            pk.respawnAt = now + (pk.spot.kind === 'health'
              ? C.PICKUP_RESPAWN_MS.health
              : pk.spot.kind === 'ammo'
                ? C.PICKUP_RESPAWN_MS.ammo
                : C.PICKUP_RESPAWN_MS.weapon);
            this.events.push({ t: 'pk', x: pk.spot.x, y: pk.spot.y, k: pk.spot.kind, p: p.id });
            break;
          }
        }
      }
    }
  }

  private collect(p: SimPlayer, pk: SimPickup, now: number): boolean {
    if (pk.spot.kind === 'health') {
      if (p.hp >= C.HEALTH_MAX) return false;
      p.hp = Math.min(C.HEALTH_MAX, p.hp + C.HEALTH_PICKUP_AMOUNT);
      return true;
    }
    if (pk.spot.kind === 'ammo') {
      const def = WEAPONS[p.weapon];
      if (p.reserve >= def.ammoReserve) return false;
      p.reserve = Math.min(def.ammoReserve, p.reserve + Math.ceil(def.ammoReserve * 0.5));
      return true;
    }
    // weapon crate
    const w = pk.spot.weapon as WeaponId | undefined;
    if (!w || !WEAPONS[w]) return false;
    if (p.owned.has(w)) {
      const def = WEAPONS[w];
      if (p.reserve >= def.ammoReserve && p.mag >= def.magazineSize) return false;
      p.reserve = def.ammoReserve;
      if (p.weapon === w) p.mag = def.magazineSize;
      return true;
    }
    if (p.owned.size >= C.MAX_WEAPONS) {
      // replace nothing — reject full kit except pistol swap
      return false;
    }
    p.owned.add(w);
    p.weapon = w;
    p.mag = WEAPONS[w].magazineSize;
    p.reserve = WEAPONS[w].ammoReserve;
    p.switchAt = now + C.SWITCH_COOLDOWN_MS;
    p.reloadEndAt = 0;
    return true;
  }

  // ── Snapshot ───────────────────────────────────────────────────────────

  snapshot(): Snapshot {
    const ps: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      ps.push({
        i: p.id,
        x: Math.round(p.ms.body.x * 10) / 10,
        y: Math.round(p.ms.body.y * 10) / 10,
        vx: Math.round(p.ms.body.vx * 10) / 10,
        vy: Math.round(p.ms.body.vy * 10) / 10,
        a: Math.round(p.aim * 1000) / 1000,
        hp: p.hp,
        w: p.weapon,
        m: p.mag,
        r: p.reserve,
        f: Math.round(p.ms.fuel),
        al: p.alive ? 1 : 0,
        k: p.kills,
        d: p.deaths,
        rl: p.reloadEndAt ? Math.max(0, Math.round(p.reloadEndAt - Date.now())) : 0,
        si: p.lastSeq,
        na: p.grenades,
        ob: ownedMask(p.owned),
      });
    }
    return {
      tick: this.tick,
      time: Date.now(),
      phase: this.phase,
      ps,
      bs: this.bullets.map((b) => ({ i: b.id, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), w: b.weapon, o: b.owner })),
      gs: this.grenades.map((g) => ({ i: g.id, x: Math.round(g.body.x), y: Math.round(g.body.y), vx: Math.round(g.body.vx), vy: Math.round(g.body.vy), fu: Math.round(g.fuse) })),
      pk: this.pickups.filter((p) => p.active).map((p) => ({
        i: p.id, x: p.spot.x, y: p.spot.y, k: p.spot.kind,
        ...(p.spot.weapon ? { w: p.spot.weapon as WeaponId } : {}),
      })),
      ev: this.events.slice(),
      ...(this.phase === 'playing' ? { matchEndsAt: this.matchEndsAt } : {}),
    };
  }

  clearEvents() {
    // Fresh array (not length=0): a delivered snapshot may still hold the
    // previous array by reference — truncating it would erase its events.
    this.events = [];
  }
}

function ownedMask(owned: Set<WeaponId>): number {
  let m = 0;
  for (let i = 0; i < WEAPON_IDS.length; i++) {
    if (owned.has(WEAPON_IDS[i])) m |= 1 << i;
  }
  return m;
}
