/**
 * MenuScene — animated background for the main menu page (original art,
 * generated at runtime: starfield, drifting silhouettes and jet trails).
 */
import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  private stars: Phaser.GameObjects.Graphics | null = null;
  private drift = 0;

  constructor() {
    super('Menu');
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a120b, 0x1a120b, 0x362514, 0x362514, 1);
    bg.fillRect(0, 0, w, h);

    this.stars = this.add.graphics();
    let s = 123456789;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const starData: { x: number; y: number; r: number; a: number; layer: number }[] = [];
    for (let i = 0; i < 140; i++) {
      starData.push({
        x: rnd() * (w + 400),
        y: rnd() * h,
        r: 0.6 + rnd() * 1.6,
        a: 0.25 + rnd() * 0.7,
        layer: rnd() < 0.5 ? 0.25 : 0.6,
      });
    }
    (this as unknown as { _starData: typeof starData })._starData = starData;

    // distant platform silhouettes
    const far = this.add.graphics().setAlpha(0.8);
    far.fillStyle(0x241a0d, 1);
    for (let i = 0; i < 6; i++) {
      const bw = 90 + rnd() * 220;
      const bx = rnd() * w;
      const by = h * 0.55 + rnd() * h * 0.4;
      far.fillRect(bx, by, bw, 14);
      if (rnd() > 0.5) far.fillRect(bx + bw / 2 - 2, by - 30 - rnd() * 40, 4, 30 + rnd() * 40);
    }
  }

  update(time: number, deltaMs: number): void {
    const starData = (this as unknown as { _starData?: { x: number; y: number; r: number; a: number; layer: number }[] })._starData;
    const g = this.stars;
    if (!g || !starData) return;
    this.drift += deltaMs * 0.006;
    const w = this.scale.width;
    g.clear();
    for (const st of starData) {
      const x = (st.x - this.drift * st.layer) % (w + 400);
      const xx = x < 0 ? x + w + 400 : x;
      const tw = 0.6 + 0.4 * Math.sin(time * 0.002 + st.x);
      g.fillStyle(0xffffff, st.a * tw);
      g.fillCircle(xx - 200, st.y, st.r);
    }
  }
}
