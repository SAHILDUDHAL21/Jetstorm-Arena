/**
 * Original multi-level arena maps. Pure data: solid rectangles (top-left
 * anchored), spawn points (feet position), pickup spots, and a color theme.
 * No layout is copied from any existing game.
 */
import { WORLD_H, WORLD_W } from './constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpawnPoint {
  x: number; // feet position
  y: number;
}

export interface PickupSpot {
  x: number; // feet position
  y: number;
  kind: 'health' | 'ammo' | 'weapon';
  weapon?: 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rocket';
}

export interface MapTheme {
  bgTop: number;
  bgBottom: number;
  far: number;
  platform: number;
  platformEdge: number;
  accent: number;
  fog: number;
}

export interface MapDef {
  id: string;
  name: string;
  w: number;
  h: number;
  solids: Rect[];
  deco: Rect[];
  spawns: SpawnPoint[];
  pickups: PickupSpot[];
  theme: MapTheme;
}

function border(): Rect[] {
  // Enclosed arena: ceiling + walls (ground is per-map).
  return [
    { x: 0, y: 0, w: WORLD_W, h: 60 },
    { x: 0, y: 0, w: 60, h: WORLD_H },
    { x: WORLD_W - 60, y: 0, w: 60, h: WORLD_H },
  ];
}

function stairs(x: number, y: number, stepW: number, stepH: number, n: number, dir: 1 | -1): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: x + dir * i * stepW, y: y - i * stepH, w: stepW, h: WORLD_H - (y - i * stepH) });
  }
  return out;
}

// ─── Map 1 · Foundry Yard ─────────────────────────────────────────────────
const foundry: MapDef = {
  id: 'foundry',
  name: 'Foundry Yard',
  w: WORLD_W,
  h: WORLD_H,
  solids: [
    ...border(),
    { x: 0, y: 1560, w: WORLD_W, h: 240 }, // ground floor
    // low cover walls
    { x: 640, y: 1440, w: 60, h: 120 },
    { x: 1120, y: 1440, w: 60, h: 120 },
    { x: 2020, y: 1440, w: 60, h: 120 },
    { x: 2500, y: 1440, w: 60, h: 120 },
    // central block with underpass tunnel (pillar feet hang clear of the
    // ground so the passage is walkable at floor level)
    { x: 1440, y: 1300, w: 320, h: 110 },
    { x: 1460, y: 1410, w: 36, h: 80 },
    { x: 1704, y: 1410, w: 36, h: 80 },
    // step pads up to catwalk
    { x: 1050, y: 1320, w: 120, h: 30 },
    { x: 2030, y: 1320, w: 120, h: 30 },
    // mid platforms
    { x: 320, y: 1180, w: 420, h: 44 },
    { x: 2460, y: 1180, w: 420, h: 44 },
    { x: 1180, y: 1120, w: 840, h: 40 }, // center catwalk
    // side shelters
    { x: 140, y: 1240, w: 220, h: 36 },
    { x: 2840, y: 1240, w: 220, h: 36 },
    // upper platforms
    { x: 180, y: 880, w: 380, h: 40 },
    { x: 2640, y: 880, w: 380, h: 40 },
    { x: 760, y: 820, w: 240, h: 36 },
    { x: 2200, y: 820, w: 240, h: 36 },
    // high floating pillars (air cover)
    { x: 980, y: 700, w: 40, h: 140 },
    { x: 2180, y: 700, w: 40, h: 140 },
    // top perches
    { x: 1420, y: 560, w: 360, h: 40 },
    { x: 760, y: 480, w: 200, h: 32 },
    { x: 2240, y: 480, w: 200, h: 32 },
  ],
  deco: [
    { x: 1180, y: 1120, w: 840, h: 8 },
    { x: 1440, y: 1300, w: 320, h: 10 },
    { x: 640, y: 1440, w: 60, h: 6 },
    { x: 1120, y: 1440, w: 60, h: 6 },
    { x: 2020, y: 1440, w: 60, h: 6 },
    { x: 2500, y: 1440, w: 60, h: 6 },
  ],
  spawns: [
    { x: 220, y: 1560 },
    { x: 2980, y: 1560 },
    { x: 500, y: 1180 },
    { x: 2700, y: 1180 },
    { x: 360, y: 880 },
    { x: 2840, y: 880 },
    { x: 1600, y: 1300 },
    { x: 1600, y: 560 },
  ],
  pickups: [
    { x: 250, y: 1240, kind: 'health' },
    { x: 2950, y: 1240, kind: 'health' },
    { x: 1600, y: 1120, kind: 'health' },
    { x: 740, y: 1180, kind: 'ammo' },
    { x: 2460, y: 1180, kind: 'ammo' },
    { x: 1600, y: 1560, kind: 'ammo' },
    { x: 500, y: 1560, kind: 'weapon', weapon: 'smg' },
    { x: 2700, y: 1560, kind: 'weapon', weapon: 'rifle' },
    { x: 1700, y: 1300, kind: 'weapon', weapon: 'shotgun' },
    { x: 220, y: 880, kind: 'weapon', weapon: 'sniper' },
    { x: 2980, y: 880, kind: 'weapon', weapon: 'rocket' },
    { x: 2300, y: 820, kind: 'weapon', weapon: 'rifle' },
    { x: 900, y: 820, kind: 'weapon', weapon: 'smg' },
  ],
  theme: {
    bgTop: 0x1a120b,
    bgBottom: 0x362514,
    far: 0x241a0d,
    platform: 0x8a6a42,
    platformEdge: 0xc7a468,
    accent: 0xff9d3c,
    fog: 0x140c05,
  },
};

// ─── Map 2 · Skyline Docks ────────────────────────────────────────────────
const docks: MapDef = {
  id: 'docks',
  name: 'Skyline Docks',
  w: WORLD_W,
  h: WORLD_H,
  solids: [
    ...border(),
    { x: 0, y: 1600, w: WORLD_W, h: 200 }, // water-level ground
    // long dock piers
    { x: 260, y: 1360, w: 700, h: 40 },
    { x: 2240, y: 1360, w: 700, h: 40 },
    // container stacks (cover maze)
    { x: 520, y: 1480, w: 160, h: 120 },
    { x: 800, y: 1480, w: 160, h: 120 },
    { x: 1300, y: 1480, w: 120, h: 120 },
    { x: 1780, y: 1480, w: 120, h: 120 },
    { x: 2240, y: 1480, w: 160, h: 120 },
    { x: 2520, y: 1480, w: 160, h: 120 },
    { x: 660, y: 1360, w: 140, h: 120 },
    { x: 2400, y: 1360, w: 140, h: 120 },
    // warehouse with interior opening (hanging pillars leave a walkable
    // floor gap so the passage can be entered at ground level)
    { x: 1380, y: 1180, w: 440, h: 140 },
    { x: 1420, y: 1320, w: 60, h: 210 },
    { x: 1720, y: 1320, w: 60, h: 210 },
    // crane tower + arm (left high)
    ...stairs(120, 1560, 150, 90, 3, 1),
    { x: 60, y: 1290, w: 120, h: 510 },
    { x: 60, y: 1250, w: 420, h: 44 },
    { x: 420, y: 1000, w: 44, h: 300 },
    { x: 420, y: 960, w: 520, h: 40 },
    // right tower
    ...stairs(3020, 1560, 150, 90, 3, -1),
    { x: 3020, y: 1290, w: 120, h: 510 },
    { x: 2720, y: 1250, w: 420, h: 44 },
    { x: 2736, y: 1000, w: 44, h: 300 },
    { x: 2260, y: 960, w: 520, h: 40 },
    // sky bridges
    { x: 1100, y: 820, w: 380, h: 36 },
    { x: 1720, y: 820, w: 380, h: 36 },
    { x: 1440, y: 700, w: 320, h: 36 },
  ],
  deco: [
    { x: 260, y: 1360, w: 700, h: 6 },
    { x: 2240, y: 1360, w: 700, h: 6 },
    { x: 1380, y: 1180, w: 440, h: 8 },
    { x: 60, y: 1250, w: 420, h: 6 },
    { x: 2720, y: 1250, w: 420, h: 6 },
    { x: 420, y: 960, w: 520, h: 6 },
    { x: 2260, y: 960, w: 520, h: 6 },
  ],
  spawns: [
    { x: 180, y: 1600 },
    { x: 3020, y: 1600 },
    { x: 500, y: 1360 },
    { x: 2700, y: 1360 },
    { x: 200, y: 1250 },
    { x: 3000, y: 1250 },
    { x: 1600, y: 1180 },
    { x: 1600, y: 700 },
  ],
  pickups: [
    { x: 250, y: 1250, kind: 'health' },
    { x: 2950, y: 1250, kind: 'health' },
    { x: 1600, y: 700, kind: 'health' },
    { x: 760, y: 1600, kind: 'ammo' },
    { x: 2440, y: 1600, kind: 'ammo' },
    { x: 1600, y: 1600, kind: 'ammo' },
    { x: 700, y: 1360, kind: 'weapon', weapon: 'smg' },
    { x: 2500, y: 1360, kind: 'weapon', weapon: 'rifle' },
    { x: 1600, y: 1180, kind: 'weapon', weapon: 'shotgun' },
    { x: 600, y: 960, kind: 'weapon', weapon: 'sniper' },
    { x: 2600, y: 960, kind: 'weapon', weapon: 'rocket' },
    { x: 1200, y: 820, kind: 'weapon', weapon: 'smg' },
    { x: 2000, y: 820, kind: 'weapon', weapon: 'shotgun' },
  ],
  theme: {
    bgTop: 0x1c140c,
    bgBottom: 0x3a2a18,
    far: 0x271c10,
    platform: 0x90754c,
    platformEdge: 0xd0b077,
    accent: 0x3fd0c9,
    fog: 0x150d06,
  },
};

// ─── Map 3 · Cavern Cross ─────────────────────────────────────────────────
const cavern: MapDef = {
  id: 'cavern',
  name: 'Cavern Cross',
  w: WORLD_W,
  h: WORLD_H,
  solids: [
    ...border(),
    { x: 0, y: 1600, w: WORLD_W, h: 200 },
    // cave floor bumps
    { x: 900, y: 1520, w: 200, h: 80 },
    { x: 2100, y: 1520, w: 200, h: 80 },
    // central rock pillar cluster with cross gap
    { x: 1460, y: 1180, w: 280, h: 120 },
    { x: 1560, y: 1300, w: 80, h: 300 },
    // side galleries
    { x: 260, y: 1300, w: 520, h: 44 },
    { x: 2420, y: 1300, w: 520, h: 44 },
    { x: 420, y: 1080, w: 320, h: 40 },
    { x: 2460, y: 1080, w: 320, h: 40 },
    // stalactite columns
    { x: 800, y: 60, w: 60, h: 320 },
    { x: 2340, y: 60, w: 60, h: 320 },
    { x: 1180, y: 60, w: 44, h: 220 },
    { x: 1976, y: 60, w: 44, h: 220 },
    // upper galleries
    { x: 200, y: 780, w: 460, h: 40 },
    { x: 2540, y: 780, w: 460, h: 40 },
    { x: 900, y: 700, w: 300, h: 36 },
    { x: 2000, y: 700, w: 300, h: 36 },
    // crown platform
    { x: 1380, y: 520, w: 440, h: 40 },
    { x: 1200, y: 360, w: 200, h: 32 },
    { x: 1800, y: 360, w: 200, h: 32 },
    // mushroom ledges mid-air
    { x: 620, y: 480, w: 180, h: 30 },
    { x: 2400, y: 480, w: 180, h: 30 },
  ],
  deco: [
    { x: 1460, y: 1180, w: 280, h: 10 },
    { x: 260, y: 1300, w: 520, h: 8 },
    { x: 2420, y: 1300, w: 520, h: 8 },
    { x: 200, y: 780, w: 460, h: 8 },
    { x: 2540, y: 780, w: 460, h: 8 },
    { x: 1380, y: 520, w: 440, h: 8 },
  ],
  spawns: [
    { x: 180, y: 1600 },
    { x: 3020, y: 1600 },
    { x: 420, y: 1300 },
    { x: 2780, y: 1300 },
    { x: 500, y: 1080 },
    { x: 2700, y: 1080 },
    { x: 1600, y: 1180 },
    { x: 1600, y: 520 },
  ],
  pickups: [
    { x: 300, y: 780, kind: 'health' },
    { x: 2900, y: 780, kind: 'health' },
    { x: 1600, y: 520, kind: 'health' },
    { x: 950, y: 1520, kind: 'ammo' },
    { x: 2250, y: 1520, kind: 'ammo' },
    { x: 1600, y: 1600, kind: 'ammo' },
    { x: 700, y: 1300, kind: 'weapon', weapon: 'smg' },
    { x: 2500, y: 1300, kind: 'weapon', weapon: 'rifle' },
    { x: 1600, y: 1300, kind: 'weapon', weapon: 'shotgun' },
    { x: 260, y: 1080, kind: 'weapon', weapon: 'sniper' },
    { x: 2940, y: 1080, kind: 'weapon', weapon: 'rocket' },
    { x: 1000, y: 700, kind: 'weapon', weapon: 'smg' },
    { x: 2200, y: 700, kind: 'weapon', weapon: 'shotgun' },
    { x: 700, y: 480, kind: 'weapon', weapon: 'rifle' },
    { x: 2490, y: 480, kind: 'weapon', weapon: 'rifle' },
  ],
  theme: {
    bgTop: 0x181008,
    bgBottom: 0x31220f,
    far: 0x221709,
    platform: 0x7a5c3a,
    platformEdge: 0xb28f58,
    accent: 0x9d6bff,
    fog: 0x120b04,
  },
};

export const MAPS: Record<string, MapDef> = { foundry, docks, cavern };
export const MAP_IDS = ['foundry', 'docks', 'cavern'] as const;
export type MapId = (typeof MAP_IDS)[number];

export function getMap(id: string): MapDef {
  return MAPS[id] ?? foundry;
}

/** Solids merged with world bounds walls (used by the server simulation). */
export function mapSolids(id: string): Rect[] {
  return getMap(id).solids;
}
