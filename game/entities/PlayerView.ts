/**
 * PlayerView — visual bundle for one player (body sprite, weapon sprite,
 * jet flame, name tag, HP bar). Shared by the predicted local player and the
 * interpolated remote players.
 */
import Phaser from 'phaser';
import { WEAPON_TEX } from '../scenes/PreloadScene';
import type { WeaponId } from '../../shared/types';

export class PlayerView {
  sprite: Phaser.GameObjects.Sprite;
  weapon: Phaser.GameObjects.Sprite;
  flame: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  reloadBar: Phaser.GameObjects.Graphics;
  palette: number;
  paletteKey: string;
  depthBase = 10;

  constructor(scene: Phaser.Scene, paletteKey: string, palette: number, name: string, isLocal: boolean) {
    this.palette = palette;
    this.paletteKey = paletteKey;
    this.sprite = scene.add.sprite(0, 0, `sol_${paletteKey}`, 0).setDepth(this.depthBase);
    const wd = WEAPON_TEX.pistol;
    this.weapon = scene.add.sprite(0, 0, 'wpn_pistol', 0)
      .setDepth(this.depthBase + 1)
      .setOrigin(0.15, 0.55);
    this.flame = scene.add.sprite(0, 0, 'jetflame', 0).setDepth(this.depthBase - 1).setVisible(false);
    this.nameText = scene.add.text(0, -34, name, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: isLocal ? '#ffffff' : '#cbd5e1',
      stroke: '#0a0f16',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(this.depthBase + 3);
    this.hpBar = scene.add.graphics().setDepth(this.depthBase + 2);
    this.reloadBar = scene.add.graphics().setDepth(this.depthBase + 2);
  }

  setAnim(key: string): void {
    const anim = `${key}_${this.paletteKey}`;
    if (this.sprite.anims.currentAnim?.key !== anim) {
      this.sprite.play({ key: anim, repeat: -1 }, true);
    }
  }

  /** Position sprite visuals; angle is the aim angle. */
  render(x: number, y: number, aim: number, hp: number, alive: boolean, weapon: WeaponId, reloading: boolean, reloadFrac: number): void {
    this.sprite.setPosition(x, y);
    const facingLeft = Math.cos(aim) < 0;
    this.sprite.setFlipX(facingLeft);
    this.weapon.setTexture(`wpn_${weapon}`);
    const dim = WEAPON_TEX[weapon];
    const gripX = x + Math.cos(aim) * 7;
    const gripY = y + 4 + Math.sin(aim) * 7;
    this.weapon.setPosition(gripX, gripY);
    this.weapon.setRotation(aim);
    this.weapon.setFlipY(facingLeft);
    this.weapon.setVisible(alive);
    this.flame.setPosition(x - 7 * (facingLeft ? -1 : 1), y + 10);
    this.flame.setFlipX(facingLeft);
    this.nameText.setPosition(x, y - 26);
    // hp bar
    const g = this.hpBar;
    g.clear();
    if (alive && hp < 100) {
      const w = 30;
      g.fillStyle(0x140c05, 0.8);
      g.fillRect(x - w / 2 - 1, y - 24, w + 2, 5);
      g.fillStyle(hp > 50 ? 0x4ade80 : hp > 25 ? 0xfacc15 : 0xf87171, 1);
      g.fillRect(x - w / 2, y - 23, (w * hp) / 100, 3);
    }
    // reload bar
    const rg = this.reloadBar;
    rg.clear();
    if (alive && reloading && reloadFrac > 0) {
      const w = 26;
      rg.fillStyle(0x140c05, 0.8);
      rg.fillRect(x - w / 2 - 1, y - 17, w + 2, 4);
      rg.fillStyle(0xffcf8a, 1);
      rg.fillRect(x - w / 2, y - 16, w * Math.min(1, reloadFrac), 2);
    }
    void dim;
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
    this.weapon.setVisible(v);
    this.flame.setVisible(v && this.flame.visible);
    this.nameText.setVisible(v);
    if (!v) {
      this.hpBar.clear();
      this.reloadBar.clear();
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.weapon.destroy();
    this.flame.destroy();
    this.nameText.destroy();
    this.hpBar.destroy();
    this.reloadBar.destroy();
  }
}

export function muzzleOffset(weapon: WeaponId, aim: number): { x: number; y: number } {
  const d = WEAPON_TEX[weapon].w * 0.72;
  return { x: Math.cos(aim) * d, y: Math.sin(aim) * d + 4 };
}
