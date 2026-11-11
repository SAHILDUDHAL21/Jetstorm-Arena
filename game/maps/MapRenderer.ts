/**
 * MapRenderer — draws a shared map definition (original layout data) with a
 * sky, parallax silhouettes and solid platforms. Drawn once into Graphics
 * objects; never per-frame.
 */
import Phaser from 'phaser';
import { getMap, type MapDef, type Rect } from '../../shared/maps';

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class MapRenderer {
  readonly map: MapDef;

  constructor(scene: Phaser.Scene, mapId: string) {
    this.map = getMap(mapId);
    const t = this.map.theme;

    // sky bands (parallaxed very slightly)
    const bg = scene.add.graphics().setScrollFactor(0.05).setDepth(-100);
    bg.fillStyle(t.bgTop, 1);
    bg.fillRect(0, 0, this.map.w + 800, this.map.h * 0.45);
    bg.fillStyle(t.bgBottom, 1);
    bg.fillRect(0, this.map.h * 0.45, this.map.w + 800, this.map.h * 0.55 + 400);

    // parallax silhouettes (deterministic per map)
    const far = scene.add.graphics().setScrollFactor(0.35).setDepth(-90);
    const seed = hashStr(this.map.id);
    let s = seed;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    far.fillStyle(t.far, 1);
    for (let i = 0; i < 14; i++) {
      const w = 120 + rnd() * 320;
      const h = 220 + rnd() * 700;
      const x = -200 + rnd() * (this.map.w + 400);
      const y = this.map.h - 60 - h;
      far.fillRect(x, y, w, h);
      // little antenna on some
      if (rnd() > 0.6) far.fillRect(x + w / 2 - 3, y - 60 - rnd() * 50, 6, 60 + rnd() * 50);
    }
    // fog floor
    far.fillStyle(t.fog, 0.55);
    far.fillRect(-400, this.map.h - 240, this.map.w + 800, 700);

    // solids
    const g = scene.add.graphics().setDepth(0);
    this.drawSolids(g, this.map.solids, t.platform, t.platformEdge);
    const dg = scene.add.graphics().setDepth(1);
    dg.fillStyle(t.platformEdge, 0.25);
    for (const d of this.map.deco) dg.fillRect(d.x, d.y, d.w, d.h);
  }

  private drawSolids(g: Phaser.GameObjects.Graphics, solids: Rect[], fill: number, edge: number): void {
    for (const r of solids) {
      g.fillStyle(fill, 1);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle(edge, 1);
      g.fillRect(r.x, r.y, r.w, Math.min(5, r.h));
      g.fillStyle(0x140c05, 0.35);
      g.fillRect(r.x, r.y + r.h - 3, r.w, 3);
      // side shading
      g.fillStyle(0x000000, 0.18);
      g.fillRect(r.x, r.y, 3, r.h);
      g.fillRect(r.x + r.w - 3, r.y, 3, r.h);
    }
  }
}
