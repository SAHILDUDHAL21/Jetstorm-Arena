/**
 * Jetstorm Arena — shared game constants.
 * These values are used verbatim by BOTH the authoritative server simulation
 * and the client-side prediction, so movement stays in lockstep.
 * All numbers are original tuning values.
 */

export const TICK_RATE = 30; // authoritative simulation rate (Hz)
export const TICK_MS = 1000 / TICK_RATE; // ~33.3ms
export const INPUT_RATE = 60; // input/prediction step rate (Hz)
export const INPUT_DT = 1 / INPUT_RATE;
export const INTERP_DELAY_MS = 100; // remote-player interpolation delay

export const WORLD_W = 3200;
export const WORLD_H = 1800;

// Player capsule (AABB)
export const PLAYER_W = 26;
export const PLAYER_H = 38;

// Movement (per second units)
export const MOVE_ACCEL = 2400;
export const MOVE_MAX_SPEED = 330;
export const AIR_ACCEL = 1500;
export const AIR_MAX_SPEED = 360;
export const GRAVITY = 1750;
export const JUMP_VY = -640;
export const MAX_FALL = 980;
export const GROUND_FRICTION = 2000; // decel when no input on ground
export const AIR_DRAG = 220; // mild horizontal drag in air
export const COYOTE_MS = 90;
export const JUMP_BUFFER_MS = 110;
export const JUMP_LOCK_MS = 160; // ignore jetpack thrust right after a jump

// Jetpack
export const JET_FUEL_MAX = 100;
export const JET_FUEL_DRAIN = 34; // per second while thrusting
export const JET_FUEL_REGEN = 22; // per second while regenerating
export const JET_REGEN_DELAY_MS = 550; // after last thrust
export const JET_ACCEL = -2500; // upward acceleration while thrusting
export const JET_MAX_RISE = -360; // terminal rise speed while thrusting

// Combat
export const HEALTH_MAX = 100;
export const RESPAWN_MS = 3000;
export const GRENADE_COUNT_START = 2;
export const GRENADE_COUNT_MAX = 4;
export const MELEE_RANGE = 50;
export const MELEE_ARC_DOT = 0.35; // cos threshold (~69° half-arc)
export const MELEE_DAMAGE = 34;
export const MELEE_COOLDOWN_MS = 600;
export const MELEE_KNOCKBACK = 340;

// Grenades
export const GRENADE_SPEED = 560;
export const GRENADE_FUSE_MS = 2000;
export const GRENADE_RADIUS = 150;
export const GRENADE_DAMAGE_MAX = 90;
export const GRENADE_DAMAGE_MIN = 18;
export const GRENADE_BOUNCE = 0.42;
export const GRENADE_FRICTION = 0.55;

// Rocket splash
export const ROCKET_RADIUS = 130;
export const ROCKET_DAMAGE_DIRECT = 45;
export const ROCKET_DAMAGE_MAX = 78;

// Switching / reload
export const SWITCH_COOLDOWN_MS = 260;

// Pickups
export const PICKUP_R = 22; // pickup box half-size
export const PICKUP_RESPAWN_MS = { health: 10000, ammo: 12000, weapon: 15000 } as const;
export const HEALTH_PICKUP_AMOUNT = 25;

// Match rules
export const KILL_TARGET = 10;
export const TIME_LIMIT_MS = 5 * 60 * 1000;
export const COUNTDOWN_MS = 3000;
export const MAX_PLAYERS = 4;
export const ROOM_IDLE_MS = 90 * 1000; // empty room garbage collection

// Disconnect / reconnect
export const DISCONNECT_GRACE_MS = 30 * 1000;

// Bullet stepping
export const BULLET_STEP_PX = 10; // max sub-sample length for bullet movement

// Weapon slot capacity per player
export const MAX_WEAPONS = 6;
