/**
 * Shared type definitions used by both the authoritative server and the
 * Phaser/React client. Pure data — no engine or platform imports.
 */
import type { MapId } from './maps';

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rocket';

export type PickupKind = 'health' | 'ammo' | 'weapon';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  /** milliseconds between shots */
  fireRateMs: number;
  magazineSize: number;
  reloadMs: number;
  bulletSpeed: number;
  /** radians of max cone spread */
  spread: number;
  range: number;
  /** visual/feel kick (client-side) */
  recoil: number;
  ammoReserve: number;
  pellets: number;
  rocket: boolean;
  auto: boolean;
  /** screen shake + audio weight 0..1 */
  weight: number;
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'over';

export interface RoomPlayer {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  kills: number;
  deaths: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  mapId: string;
  players: RoomPlayer[];
  /** epoch ms when the countdown reaches GO */
  countdownAt?: number;
  /** epoch ms when the match time limit hits */
  matchEndsAt?: number;
  killTarget: number;
  timeLimitMs: number;
  winner: string | null;
}

export interface PlayerSnap {
  i: string; // player id
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number; // aim angle (radians)
  hp: number;
  w: WeaponId;
  m: number; // magazine ammo
  r: number; // reserve ammo
  f: number; // jetpack fuel
  al: 0 | 1; // alive
  k: number; // kills
  d: number; // deaths
  rl: number; // reload remaining ms (0 = not reloading)
  si: number; // last processed input sequence (for prediction rewind)
  na: number; // grenade count
  ob: number; // owned weapons bitmask (bit i = WEAPON_IDS[i])
}

export interface BulletSnap {
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: WeaponId;
  o: string; // owner id
}

export interface GrenadeSnap {
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fu: number; // fuse remaining ms
}

export interface PickupSnap {
  i: number;
  x: number;
  y: number;
  k: PickupKind;
  w?: WeaponId; // for weapon crates
}

export type GameEvent =
  | { t: 'shot'; i: string; x: number; y: number; a: number; w: WeaponId }
  | { t: 'imp'; x: number; y: number; a: number } // bullet wall impact (cosmetic)
  | { t: 'hit'; i: string; x: number; y: number; dmg: number; by?: string }
  | { t: 'kill'; k: string; v: string; w: WeaponId | 'grenade' | 'melee' | 'void' }
  | { t: 'boom'; x: number; y: number; r: number; big: boolean }
  | { t: 'nade'; i: string; x: number; y: number; a: number }
  | { t: 'melee'; i: string; x: number; y: number; a: number }
  | { t: 'spawn'; i: string; x: number; y: number }
  | { t: 'reload'; i: string }
  | { t: 'pk'; x: number; y: number; k: PickupKind; p: string }
  | { t: 'over'; winner: string | null }
  | { t: 'conn'; i: string; on: boolean }
  | { t: 'host'; i: string }
  | { t: 'chat'; f: string; m: string }
  | { t: 'sys'; m: string };

export interface Snapshot {
  tick: number;
  time: number; // server epoch ms
  phase: RoomPhase;
  ps: PlayerSnap[];
  bs: BulletSnap[];
  gs: GrenadeSnap[];
  pk: PickupSnap[];
  ev: GameEvent[];
  matchEndsAt?: number;
}

export interface MatchResult {
  players: { id: string; name: string; kills: number; deaths: number }[];
  winner: string | null;
  reason: 'kills' | 'time';
}

// ─── Protocol messages ────────────────────────────────────────────────────

export const INPUT_JUMP = 1;
export const INPUT_JET = 2;
export const INPUT_FIRE = 4;
export const INPUT_GRENADE = 8;
export const INPUT_MELEE = 16;
export const INPUT_RELOAD = 32;

/** One 60 Hz input frame. flags bitmask; mx ∈ {-1,0,1}; aim normalized-ish. */
export interface InputFrame {
  seq: number;
  fl: number; // INPUT_* bitmask
  mx: -1 | 0 | 1;
  ax: number;
  ay: number;
}

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; name: string; token?: string; mapId?: MapId }
  | { t: 'join'; code: string; name: string; token?: string }
  | { t: 'quick'; name: string; token?: string }
  | { t: 'leave' }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'input'; frames: InputFrame[] }
  | { t: 'switch'; w: WeaponId }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number };

export type ServerMsg =
  | { t: 'welcome'; pid: string; token: string; room?: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'room'; room: RoomState }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'chat'; f: string; m: string; sys?: boolean }
  | { t: 'over'; results: MatchResult }
  | { t: 'notice'; msg: string }
  | { t: 'pong'; ts: number };

export type ErrorCode =
  | 'bad_name'
  | 'bad_code'
  | 'room_not_found'
  | 'room_full'
  | 'match_started'
  | 'bad_token'
  | 'rate_limited'
  | 'bad_message'
  | 'not_host'
  | 'already_in_room'
  | 'server_error';
