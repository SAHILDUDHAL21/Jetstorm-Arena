/**
 * PreloadScene — generates ALL game art procedurally on canvas (original
 * artwork, no external asset files): 4-palette soldier sprite sheets,
 * weapons, projectiles, pickups, explosion/flash frames, particles and UI
 * markers. Then starts the gameplay scene.
 */
import Phaser from 'phaser';

export const PALETTES = [
  { key: 'crimson', main: '#e04856', dark: '#7c1f2a', light: '#ff8b95' },
  { key: 'cobalt', main: '#3d7de0', dark: '#1d3f77', light: '#8fb4ff' },
  { key: 'amber', main: '#e0913d', dark: '#7a4c1a', light: '#ffc98b' },
  { key: 'jade', main: '#3dc985', dark: '#17603e', light: '#8effd0' },
] as const;

export const FRAME_W = 32;
export const FRAME_H = 40;
const COLS = 6;
const ROWS = 3;

export interface FramePoses {
  idle: [number, number];
  run: [number, number, number, number, number, number];
  jump: number;
  fall: number;
  jet: [number, number];
  hurt: number;
  dead: [number, number, number, number];
}

export const FRAME_INDEX: FramePoses = {
  idle: [0, 1],
  run: [2, 3, 4, 5, 6, 7],
  jump: 8,
  fall: 9,
  jet: [10, 11],
  hurt: 12,
  dead: [13, 14, 15, 16],
};

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function circle(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

interface Pose {
  bob: number;
  lean: number;
  legL: number;
  legR: number;
  legSpread: number;
  dangle: boolean;
  hurt: boolean;
  angle: number; // for dead frames
  jetGlow: boolean;
}

function poseFor(index: number): Pose {
  const p: Pose = { bob: 0, lean: 0, legL: 0, legR: 0, legSpread: 0, dangle: false, hurt: false, angle: 0, jetGlow: false };
  switch (index) {
    case 0: return p;
    case 1: return { ...p, bob: 1 };
    case 2: return { ...p, legL: -4, legR: 4, bob: 0, lean: 1 };
    case 3: return { ...p, legL: 0, legR: 0, bob: -1, lean: 1 };
    case 4: return { ...p, legL: 4, legR: -4, bob: 0, lean: 1 };
    case 5: return { ...p, legL: 0, legR: 0, bob: -1, lean: 1 };
    case 6: return { ...p, legL: -4, legR: 4, bob: 0, lean: 1 };
    case 7: return { ...p, legL: 0, legR: 0, bob: -1, lean: 1 };
    case 8: return { ...p, legL: -3, legR: 2, legSpread: 1 };
    case 9: return { ...p, legL: -2, legR: 3, legSpread: 2 };
    case 10: return { ...p, dangle: true, jetGlow: true };
    case 11: return { ...p, dangle: true, jetGlow: true, bob: 1 };
    case 12: return { ...p, hurt: true, lean: -2 };
    case 13: return { ...p, angle: 0.25 };
    case 14: return { ...p, angle: 0.6 };
    case 15: return { ...p, angle: 1.1 };
    case 16: return { ...p, angle: 1.35 };
    default: return p;
  }
}

/** Draw one frame of the soldier sprite into ctx at (ox, oy). */
function drawSoldier(ctx: Ctx, ox: number, oy: number, pal: (typeof PALETTES)[number], index: number): void {
  const pose = poseFor(index);
  ctx.save();
  ctx.translate(Math.round(ox + FRAME_W / 2), Math.round(oy + FRAME_H - 2));
  if (pose.angle) ctx.rotate(pose.angle);
  ctx.translate(-FRAME_W / 2, -(FRAME_H - 2));

  const B = pose.bob;
  const L = pose.lean;
  const legY = 26 + B;
  const skin = '#e8c9a8';
  const glass = '#0d1622';

  // jetpack (behind, on back)
  px(ctx, 3 + L, 13 + B, 6, 12, '#2a323d');
  px(ctx, 3 + L, 13 + B, 6, 3, '#454f5d');
  if (pose.jetGlow) {
    circle(ctx, 6 + L, 26 + B, 2.4, 'rgba(255,190,90,0.9)');
  }
  // legs
  if (pose.dangle) {
    px(ctx, 11, legY + 1, 4, 8, pal.dark);
    px(ctx, 17, legY + 2, 4, 7, pal.dark);
    px(ctx, 11, legY + 8, 4, 3, '#23282f');
    px(ctx, 17, legY + 8, 4, 3, '#23282f');
  } else {
    px(ctx, 11 + pose.legL, legY, 4, 8 - Math.abs(pose.legL) / 2, pal.dark);
    px(ctx, 17 + pose.legR, legY, 4, 8 - Math.abs(pose.legR) / 2, pal.dark);
    px(ctx, 10 + pose.legL, legY + 8, 5, 3, '#23282f');
    px(ctx, 17 + pose.legR, legY + 8, 5, 3, '#23282f');
  }
  // torso armor
  roundRect(ctx, 9 + L, 13 + B, 14, 14, 2, pal.main);
  px(ctx, 9 + L, 13 + B, 14, 3, pal.light);
  px(ctx, 13 + L, 16 + B, 6, 6, pal.dark);
  // arms
  px(ctx, 7 + L, 15 + B, 3, 8, pal.dark);
  px(ctx, 22 + L, 15 + B, 3, 8, pal.dark);
  // head + helmet
  roundRect(ctx, 10 + L + (pose.hurt ? -1 : 0), 4 + B, 12, 10, 3, pal.main);
  px(ctx, 11 + L + (pose.hurt ? -1 : 0), 7 + B, 10, 4, glass);
  px(ctx, 12 + L + (pose.hurt ? -1 : 0), 8 + B, 3, 1, '#5d93b8');
  px(ctx, 15 + L + (pose.hurt ? -1 : 0), 4 + B, 3, 1, pal.light);
  ctx.restore();
}

// ── Weapons ──────────────────────────────────────────────────────────────

export const WEAPON_TEX = {
  pistol: { w: 18, h: 12 },
  smg: { w: 24, h: 12 },
  rifle: { w: 28, h: 12 },
  shotgun: { w: 26, h: 12 },
  sniper: { w: 32, h: 12 },
  rocket: { w: 30, h: 14 },
} as const;

function drawWeapon(ctx: Ctx, key: keyof typeof WEAPON_TEX, ox: number, oy: number): void {
  const gun = '#313b47';
  const dark = '#1c222b';
  const grip = '#3d2f23';
  const metal = '#9aa7b4';
  const x = ox;
  const y = oy + 2;
  switch (key) {
    case 'pistol':
      px(ctx, x, y + 1, 14, 5, gun);
      px(ctx, x + 12, y + 1, 4, 3, metal);
      px(ctx, x + 1, y + 5, 5, 6, grip);
      break;
    case 'smg':
      px(ctx, x, y + 1, 18, 5, gun);
      px(ctx, x + 16, y, 6, 3, dark);
      px(ctx, x + 4, y + 5, 4, 6, grip);
      px(ctx, x + 9, y + 5, 3, 5, dark);
      break;
    case 'rifle':
      px(ctx, x, y + 1, 22, 5, gun);
      px(ctx, x + 20, y + 1, 7, 3, dark);
      px(ctx, x + 2, y, 7, 2, metal);
      px(ctx, x + 5, y + 5, 4, 6, grip);
      px(ctx, x, y + 3, 4, 5, dark);
      break;
    case 'shotgun':
      px(ctx, x, y + 1, 20, 6, gun);
      px(ctx, x + 8, y + 6, 8, 3, '#6b4a2a');
      px(ctx, x + 18, y + 1, 5, 5, dark);
      px(ctx, x, y + 2, 5, 4, '#6b4a2a');
      break;
    case 'sniper':
      px(ctx, x, y + 1, 26, 4, gun);
      px(ctx, x + 24, y + 1, 7, 3, dark);
      px(ctx, x + 6, y - 2, 9, 3, dark);
      px(ctx, x + 8, y - 1, 5, 1, '#7fd2ff');
      px(ctx, x + 4, y + 4, 4, 6, grip);
      px(ctx, x, y + 3, 4, 6, dark);
      break;
    case 'rocket':
      px(ctx, x, y, 22, 9, '#394231');
      px(ctx, x + 20, y + 1, 8, 7, dark);
      circle(ctx, x + 28, y + 4.5, 3.4, '#c94b32');
      px(ctx, x + 4, y + 8, 4, 4, grip);
      px(ctx, x, y + 3, 3, 3, '#20261e');
      break;
  }
}

// ── Other textures ───────────────────────────────────────────────────────

function drawMuzzleFlash(ctx: Ctx, ox: number, oy: number, frame: number): void {
  const size = 24;
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  const r = 4 + frame * 3;
  const spikes = 4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(frame * 0.5);
  for (let i = 0; i < spikes; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = frame === 0 ? '#fff6d8' : frame === 1 ? '#ffd23c' : '#ff9d3c';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.35, -r * 0.35);
    ctx.lineTo(0, 0);
    ctx.lineTo(-r * 0.35, -r * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  circle(ctx, 0, 0, r * 0.5, frame === 0 ? '#ffffff' : '#ffe089');
  ctx.restore();
}

function drawExplosion(ctx: Ctx, ox: number, oy: number, frame: number): void {
  const size = 64;
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  const r = 6 + frame * 5.4;
  if (frame < 5) {
    circle(ctx, cx, cy, r, frame < 2 ? '#fff3c4' : frame < 4 ? '#ff9d3c' : '#c2452c');
    if (frame >= 1) {
      circle(ctx, cx, cy, r * 0.55, frame < 3 ? '#fffbe8' : '#ffd23c');
    }
    if (frame >= 2) {
      circle(ctx, cx, cy, r * 0.25, '#ffffff');
    }
    // debris sparks (deterministic)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + frame * 0.35;
      const d = r * (0.9 + ((i * 37) % 10) / 22);
      px(ctx, cx + Math.cos(a) * d - 1, cy + Math.sin(a) * d - 1, 2, 2, '#ffd23c');
    }
  }
  // smoke ring on later frames
  if (frame >= 3) {
    ctx.globalAlpha = frame === 3 ? 0.5 : frame === 4 ? 0.35 : 0.22;
    circle(ctx, cx, cy, r * 1.05, '#5d6672');
    ctx.globalAlpha = 1;
  }
}

function drawPickupCrate(ctx: Ctx, ox: number, oy: number, kind: 'health' | 'ammo' | 'weapon', weapon?: string): void {
  const s = 28;
  px(ctx, ox, oy, s, s, '#242c36');
  px(ctx, ox, oy, s, 3, '#4a5866');
  px(ctx, ox, oy + s - 3, s, 3, '#151b22');
  const border =
    kind === 'health' ? '#ff5f6e' : kind === 'ammo' ? '#ffd23c' : weapon === 'rocket' ? '#ff8b4a' : weapon === 'sniper' ? '#7fd2ff' : '#9fe86f';
  px(ctx, ox + 1, oy + 3, 2, s - 6, border);
  px(ctx, ox + s - 3, oy + 3, 2, s - 6, border);
  const cx = ox + s / 2;
  const cy = oy + s / 2;
  if (kind === 'health') {
    px(ctx, cx - 2, cy - 7, 4, 14, '#ff5f6e');
    px(ctx, cx - 7, cy - 2, 14, 4, '#ff5f6e');
    px(ctx, cx - 1, cy - 5, 2, 10, '#ffd3d7');
  } else if (kind === 'ammo') {
    for (let i = -1; i <= 1; i++) {
      px(ctx, cx - 2 + i * 5, cy - 6, 4, 8, '#ffd23c');
      px(ctx, cx - 2 + i * 5, cy - 7, 4, 2, '#fff3c4');
    }
  } else {
    // mini weapon silhouette
    px(ctx, cx - 8, cy - 2, 14, 4, '#c8d2dc');
    px(ctx, cx - 5, cy + 2, 3, 5, '#8a95a2');
    px(ctx, cx + 6, cy - 1, 4, 2, '#8a95a2');
    px(ctx, cx - 8, cy - 2, 2, 2, border);
  }
}

function drawJetFlame(ctx: Ctx, ox: number, oy: number, frame: number): void {
  const w = 12;
  const h = 18;
  const flick = frame === 0 ? 0 : 2;
  ctx.fillStyle = '#ff9d3c';
  ctx.beginPath();
  ctx.moveTo(ox + 2, oy);
  ctx.lineTo(ox + w - 2, oy);
  ctx.lineTo(ox + w / 2 + flick, oy + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd23c';
  ctx.beginPath();
  ctx.moveTo(ox + 4, oy);
  ctx.lineTo(ox + w - 4, oy);
  ctx.lineTo(ox + w / 2, oy + h - 6 - flick);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  px(ctx, ox + 5, oy, w - 10, 4, '#fff6d8');
}

function drawSmoke(ctx: Ctx, ox: number, oy: number): void {
  const cx = ox + 12;
  const cy = oy + 12;
  ctx.globalAlpha = 0.5;
  circle(ctx, cx, cy, 11, '#7b8794');
  ctx.globalAlpha = 0.6;
  circle(ctx, cx - 2, cy + 2, 7, '#9aa5b1');
  ctx.globalAlpha = 0.7;
  circle(ctx, cx + 3, cy - 3, 5, '#b9c2cc');
  ctx.globalAlpha = 1;
}

function drawRocketProj(ctx: Ctx, ox: number, oy: number): void {
  px(ctx, ox, oy + 1, 14, 6, '#c8d2dc');
  px(ctx, ox + 14, oy, 6, 8, '#c2452c');
  px(ctx, ox + 18, oy + 2, 4, 4, '#ff9d3c');
  px(ctx, ox + 2, oy + 7, 4, 3, '#5d6672');
  px(ctx, ox + 9, oy + 7, 4, 3, '#5d6672');
}

function drawGrenade(ctx: Ctx, ox: number, oy: number): void {
  circle(ctx, ox + 5, oy + 5, 4.6, '#394231');
  circle(ctx, ox + 4, oy + 4, 2.2, '#5d684f');
  px(ctx, ox + 1, oy + 4, 8, 1.5, '#20261e');
  px(ctx, ox + 4, oy - 1, 2, 3, '#8a95a2');
}

function drawBullet(ctx: Ctx, ox: number, oy: number): void {
  px(ctx, ox, oy + 1, 3, 2, '#ff9d3c');
  px(ctx, ox + 3, oy + 1, 5, 2, '#ffd23c');
  px(ctx, ox + 8, oy + 1, 2, 2, '#fff6d8');
}

function drawCrosshair(ctx: Ctx, ox: number, oy: number): void {
  const c = 13;
  ctx.strokeStyle = 'rgba(10,15,22,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ox + c - 9, oy + c); ctx.lineTo(ox + c - 3, oy + c);
  ctx.moveTo(ox + c + 3, oy + c); ctx.lineTo(ox + c + 9, oy + c);
  ctx.moveTo(ox + c, oy + c - 9); ctx.lineTo(ox + c, oy + c - 3);
  ctx.moveTo(ox + c, oy + c + 3); ctx.lineTo(ox + c, oy + c + 9);
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + c - 8, oy + c); ctx.lineTo(ox + c - 3, oy + c);
  ctx.moveTo(ox + c + 3, oy + c); ctx.lineTo(ox + c + 8, oy + c);
  ctx.moveTo(ox + c, oy + c - 8); ctx.lineTo(ox + c, oy + c - 3);
  ctx.moveTo(ox + c, oy + c + 3); ctx.lineTo(ox + c, oy + c + 8);
  ctx.stroke();
  px(ctx, ox + c - 1, oy + c - 1, 2, 2, '#ff5f6e');
}

function drawHitmarker(ctx: Ctx, ox: number, oy: number): void {
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const c = 10;
  ctx.beginPath();
  ctx.moveTo(ox + c - 6, oy + c - 6); ctx.lineTo(ox + c - 2, oy + c - 2);
  ctx.moveTo(ox + c + 6, oy + c - 6); ctx.lineTo(ox + c + 2, oy + c - 2);
  ctx.moveTo(ox + c - 6, oy + c + 6); ctx.lineTo(ox + c - 2, oy + c + 2);
  ctx.moveTo(ox + c + 6, oy + c + 6); ctx.lineTo(ox + c + 2, oy + c + 2);
  ctx.stroke();
}

function drawSpark(ctx: Ctx, ox: number, oy: number): void {
  px(ctx, ox + 1, oy, 2, 4, '#fff6d8');
  px(ctx, ox, oy + 1, 4, 2, '#ffd23c');
  px(ctx, ox + 1.5, oy + 1.5, 1, 1, '#ffffff');
}

function canvasToSheet(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement, fw: number, fh: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.addSpriteSheet(key, img, { frameWidth: fw, frameHeight: fh });
      if (!tex) reject(new Error(`sheet ${key} failed`));
      else resolve();
    };
    img.onerror = () => reject(new Error(`sheet ${key} image error`));
    img.src = canvas.toDataURL('image/png');
  });
}

function addCanvasTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (tex) tex.refresh();
}

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  async create(): Promise<void> {
    // ── Soldier sheets (one per palette) ──
    for (const pal of PALETTES) {
      const canvas = document.createElement('canvas');
      canvas.width = FRAME_W * COLS;
      canvas.height = FRAME_H * ROWS;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const total = 17;
      for (let i = 0; i < total; i++) {
        const cx = (i % COLS) * FRAME_W;
        const cy = Math.floor(i / COLS) * FRAME_H;
        drawSoldier(ctx, cx, cy, pal, i);
      }
      await canvasToSheet(this, `sol_${pal.key}`, canvas, FRAME_W, FRAME_H);
    }

    // ── Weapons ──
    for (const [key, dim] of Object.entries(WEAPON_TEX)) {
      const canvas = document.createElement('canvas');
      canvas.width = dim.w;
      canvas.height = dim.h;
      const ctx = canvas.getContext('2d')!;
      drawWeapon(ctx, key as keyof typeof WEAPON_TEX, 0, 0);
      addCanvasTexture(this, `wpn_${key}`, canvas);
    }

    // ── Muzzle flash ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = 24 * 3;
      canvas.height = 24;
      const ctx = canvas.getContext('2d')!;
      for (let i = 0; i < 3; i++) drawMuzzleFlash(ctx, i * 24, 0, i);
      await canvasToSheet(this, 'flash', canvas, 24, 24);
    }

    // ── Explosion ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = 64 * 6;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      for (let i = 0; i < 6; i++) drawExplosion(ctx, i * 64, 0, i);
      await canvasToSheet(this, 'boom', canvas, 64, 64);
    }

    // ── Jet flame ──
    {
      const canvas = document.createElement('canvas');
      canvas.width = 12 * 2;
      canvas.height = 18;
      const ctx = canvas.getContext('2d')!;
      drawJetFlame(ctx, 0, 0, 0);
      drawJetFlame(ctx, 12, 0, 1);
      await canvasToSheet(this, 'jetflame', canvas, 12, 18);
    }

    // ── Single textures ──
    const mk = (key: string, w: number, h: number, draw: (ctx: Ctx) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      draw(canvas.getContext('2d')!);
      addCanvasTexture(this, key, canvas);
    };
    mk('bullet', 10, 4, (c) => drawBullet(c, 0, 0));
    mk('rocketproj', 22, 10, (c) => drawRocketProj(c, 0, 0));
    mk('grenade', 10, 10, (c) => drawGrenade(c, 0, 0));
    mk('smoke', 24, 24, (c) => drawSmoke(c, 0, 0));
    mk('spark', 4, 4, (c) => drawSpark(c, 0, 0));
    mk('crosshair', 26, 26, (c) => drawCrosshair(c, 0, 0));
    mk('hitmarker', 20, 20, (c) => drawHitmarker(c, 0, 0));
    for (const kind of ['health', 'ammo', 'weapon'] as const) {
      mk(`pk_${kind}`, 28, 28, (c) => drawPickupCrate(c, 0, 0, kind));
    }

    // ── Animations ──
    const F = FRAME_INDEX;
    for (const pal of PALETTES) {
      const k = pal.key;
      this.anims.create({ key: `idle_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [F.idle[0], F.idle[1]] }), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `run_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [...F.run] }), frameRate: 13, repeat: -1 });
      this.anims.create({ key: `jump_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [F.jump] }), frameRate: 1, repeat: -1 });
      this.anims.create({ key: `fall_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [F.fall] }), frameRate: 1, repeat: -1 });
      this.anims.create({ key: `jet_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [...F.jet] }), frameRate: 9, repeat: -1 });
      this.anims.create({ key: `hurt_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [F.hurt] }), frameRate: 1, repeat: -1 });
      this.anims.create({ key: `dead_${k}`, frames: this.anims.generateFrameNumbers(`sol_${k}`, { frames: [...F.dead] }), frameRate: 7, repeat: 0 });
    }

    // Hand off to the match scene with the init data Game.ts stashed in the registry.
    this.scene.start('Match', this.registry.get('matchInit') ?? { ready: true });
  }
}
