/**
 * Deterministic, shared physics. The SAME functions run on the authoritative
 * server and inside client-side prediction, so both agree on movement.
 * Only +,-,*,/ and clamps are used in the movement path — no transcendental
 * math — keeping IEEE-754 results identical across engines.
 */
import * as C from './constants';
import type { Rect } from './maps';

export interface Body {
  x: number; // center
  y: number; // center
  vx: number;
  vy: number;
}

export interface MoveState {
  body: Body;
  fuel: number;
  onGround: boolean;
  lastGroundedAt: number; // ms sim clock
  lastJetAt: number; // ms sim clock
  jumpQueuedAt: number; // ms sim clock (jump buffer)
}

export interface InputSnapshot {
  mx: -1 | 0 | 1;
  jump: boolean;
  jet: boolean;
}

export function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Player AABB from center position. */
export function playerRect(b: Body): Rect {
  return { x: b.x - C.PLAYER_W / 2, y: b.y - C.PLAYER_H / 2, w: C.PLAYER_W, h: C.PLAYER_H };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move along one axis and resolve collisions against solids. */
function resolveAxis(b: Body, solids: Rect[], dx: number, dy: number): { hitWall: boolean; landed: boolean; hitCeil: boolean } {
  let hitWall = false;
  let landed = false;
  let hitCeil = false;
  b.x += dx;
  b.y += dy;
  const pr = () => playerRect(b);
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const p = pr();
    if (!aabbOverlap(p.x, p.y, p.w, p.h, s.x, s.y, s.w, s.h)) continue;
    if (dx > 0) {
      b.x = s.x - C.PLAYER_W / 2;
      hitWall = true;
    } else if (dx < 0) {
      b.x = s.x + s.w + C.PLAYER_W / 2;
      hitWall = true;
    } else if (dy > 0) {
      b.y = s.y - C.PLAYER_H / 2;
      landed = true;
    } else if (dy < 0) {
      b.y = s.y + s.h + C.PLAYER_H / 2;
      hitCeil = true;
    }
  }
  return { hitWall, landed, hitCeil };
}

/**
 * Advance one fixed INPUT_DT step. Mutates `ms`. Returns events for the step.
 * `now` is the sim clock in ms (server tick time or client prediction clock).
 */
export function stepPlayer(
  ms: MoveState,
  input: InputSnapshot,
  solids: Rect[],
  now: number,
  dt: number,
): { jumped: boolean; jetting: boolean; landed: boolean } {
  const b = ms.body;
  let jumped = false;
  let jetting = false;

  // ── Horizontal ──
  const accel = ms.onGround ? C.MOVE_ACCEL : C.AIR_ACCEL;
  const maxSpd = ms.onGround ? C.MOVE_MAX_SPEED : C.AIR_MAX_SPEED;
  if (input.mx !== 0) {
    b.vx += input.mx * accel * dt;
    // Clamp to max speed in the input direction (allow external knockback to exceed)
    if (input.mx > 0 && b.vx > maxSpd) b.vx = Math.max(maxSpd, b.vx - C.AIR_DRAG * dt);
    else if (input.mx < 0 && b.vx < -maxSpd) b.vx = Math.min(-maxSpd, b.vx + C.AIR_DRAG * dt);
    else if (Math.abs(b.vx) > maxSpd) b.vx = maxSpd * Math.sign(b.vx);
  } else if (ms.onGround) {
    // ground friction toward zero
    if (b.vx > 0) b.vx = Math.max(0, b.vx - C.GROUND_FRICTION * dt);
    else b.vx = Math.min(0, b.vx + C.GROUND_FRICTION * dt);
  } else {
    if (b.vx > 0) b.vx = Math.max(0, b.vx - C.AIR_DRAG * dt);
    else b.vx = Math.min(0, b.vx + C.AIR_DRAG * dt);
  }

  // ── Jump (coyote + buffer) ──
  if (ms.onGround) ms.lastGroundedAt = now;
  if (input.jump) ms.jumpQueuedAt = now;
  const canJump = now - ms.lastGroundedAt <= C.COYOTE_MS;
  const buffered = input.jump || (ms.jumpQueuedAt > 0 && now - ms.jumpQueuedAt <= C.JUMP_BUFFER_MS);
  if (buffered && canJump && b.vy >= -20) {
    b.vy = C.JUMP_VY;
    ms.lastGroundedAt = -1e9; // consume coyote
    ms.jumpQueuedAt = 0;
    jumped = true;
  }

  // ── Jetpack ──
  const jetLocked = now - ms.lastGroundedAt < C.JUMP_LOCK_MS && b.vy < 0 && jumped;
  if (input.jet && ms.fuel > 0 && !jetLocked) {
    jetting = true;
    ms.fuel = Math.max(0, ms.fuel - C.JET_FUEL_DRAIN * dt);
    ms.lastJetAt = now;
    b.vy += C.JET_ACCEL * dt;
    if (b.vy < C.JET_MAX_RISE) b.vy = C.JET_MAX_RISE;
  } else {
    const regenAfter = ms.lastJetAt + C.JET_REGEN_DELAY_MS;
    if (now >= regenAfter) {
      ms.fuel = Math.min(C.JET_FUEL_MAX, ms.fuel + C.JET_FUEL_REGEN * dt);
    }
  }

  // ── Gravity + terminal fall ──
  b.vy += C.GRAVITY * dt;
  if (b.vy > C.MAX_FALL) b.vy = C.MAX_FALL;

  // ── Integrate + collide, Y first then X (stable for landing on edges) ──
  const resY = resolveAxis(b, solids, 0, b.vy * dt);
  if (resY.landed) {
    b.vy = 0;
    ms.onGround = true;
  } else if (resY.hitCeil) {
    b.vy = 0;
    ms.onGround = false;
  } else {
    ms.onGround = false;
  }
  const resX = resolveAxis(b, solids, b.vx * dt, 0);
  if (resX.hitWall) b.vx = 0;

  // World bounds safety (should never trigger; walls exist in maps)
  b.x = clamp(b.x, C.PLAYER_W / 2 + 1, C.WORLD_W - C.PLAYER_W / 2 - 1);
  b.y = clamp(b.y, C.PLAYER_H / 2 + 1, C.WORLD_H - C.PLAYER_H / 2 - 1);

  return { jumped, jetting, landed: resY.landed };
}

export function freshMoveState(x: number, y: number): MoveState {
  return {
    body: { x, y, vx: 0, vy: 0 },
    fuel: C.JET_FUEL_MAX,
    onGround: false,
    lastGroundedAt: -1e9,
    lastJetAt: -1e9,
    jumpQueuedAt: 0,
  };
}

/** Test whether a point sequence hits any solid; returns impact point or null. */
export function segmentHitsSolids(
  x0: number, y0: number, x1: number, y1: number, solids: Rect[], maxStep = C.BULLET_STEP_PX,
): { x: number; y: number } | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len / maxStep));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    for (let s = 0; s < solids.length; s++) {
      if (pointInRect(px, py, solids[s])) return { x: px, y: py };
    }
  }
  return null;
}

/** True when nothing solid blocks the straight line between two points. */
export function hasLineOfSight(x0: number, y0: number, x1: number, y1: number, solids: Rect[]): boolean {
  return segmentHitsSolids(x0, y0, x1, y1, solids, 12) === null;
}

/**
 * Move-and-collide a projectile ball (grenade/rocket-ish) one step with
 * bounce. Returns collision info. Uses small sub-samples for reliability.
 */
export function stepBall(
  b: Body,
  solids: Rect[],
  dt: number,
  gravity: number,
  restitution: number,
  friction: number,
  radius: number,
): { hitX: boolean; hitY: boolean; hitGround: boolean } {
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt) / C.BULLET_STEP_PX));
  const sdt = dt / steps;
  let hitX = false;
  let hitY = false;
  let hitGround = false;
  b.vy += gravity * sdt;
  for (let i = 0; i < steps; i++) {
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;
    for (let s = 0; s < solids.length; s++) {
      const r = solids[s];
      const minx = r.x - radius;
      const maxx = r.x + r.w + radius;
      const miny = r.y - radius;
      const maxy = r.y + r.h + radius;
      if (b.x < minx || b.x > maxx || b.y < miny || b.y > maxy) continue;
      // resolve on axis of least penetration
      const pxl = b.x - minx;
      const pxr = maxx - b.x;
      const pyt = b.y - miny;
      const pyb = maxy - b.y;
      const minPen = Math.min(pxl, pxr, pyt, pyb);
      if (minPen === pyt) {
        b.y = miny;
        if (b.vy > 0) {
          b.vy = -b.vy * restitution;
          b.vx *= friction;
          hitY = true;
          hitGround = true;
          if (Math.abs(b.vy) < 40) b.vy = 0;
        }
      } else if (minPen === pyb) {
        b.y = maxy;
        if (b.vy < 0) {
          b.vy = -b.vy * restitution;
          hitY = true;
        }
      } else if (minPen === pxl) {
        b.x = minx;
        if (b.vx > 0) {
          b.vx = -b.vx * restitution;
          hitX = true;
        }
      } else {
        b.x = maxx;
        if (b.vx < 0) {
          b.vx = -b.vx * restitution;
          hitX = true;
        }
      }
    }
    b.x = clamp(b.x, radius, C.WORLD_W - radius);
    b.y = clamp(b.y, radius, C.WORLD_H - radius);
  }
  return { hitX, hitY, hitGround };
}

/**
 * Choose a spawn point maximizing distance to living enemies.
 * `rand` in [0,1) breaks ties without affecting determinism of the sim body.
 */
export function pickSpawn(
  spawns: { x: number; y: number }[],
  enemies: { x: number; y: number; alive: boolean }[],
  rand: number,
): { x: number; y: number } {
  let best = spawns[0];
  let bestScore = -1;
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    let minD = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const d = dx * dx + dy * dy;
      if (d < minD) minD = d;
    }
    const score = minD === Infinity ? 1e12 + rand : minD + rand * 1000;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
