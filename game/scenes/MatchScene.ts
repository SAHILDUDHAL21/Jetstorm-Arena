/**
 * MatchScene — the real-time gameplay scene. Renders the authoritative
 * server simulation, predicts the local player, interpolates remote
 * players, and drives every effect. React renders only the HUD around it.
 */
import Phaser from 'phaser';
import * as C from '../../shared/constants';
import { WEAPONS, WEAPON_IDS } from '../../shared/weapons';
import type {
  GameEvent, PlayerSnap, Snapshot, WeaponId,
} from '../../shared/types';

import { PALETTES } from './PreloadScene';
import { bus } from '../GameBus';
import { inputState } from '../input/InputState';
import { Predictor, flagsFor } from '../physics/Predictor';
import { PlayerView, muzzleOffset } from '../entities/PlayerView';
import { MapRenderer } from '../maps/MapRenderer';
import { audio } from '../systems/AudioSystem';
import { NetClient } from '../net/NetClient';
import type { RoomState } from '../../shared/types';

interface RemoteEntry {
  view: PlayerView;
  buf: { t: number; x: number; y: number; vx: number; vy: number; aim: number }[];
  lastAim: number;
}

export interface MatchSceneInit {
  net: NetClient;
  myId: string;
  mapId: string;
  room: RoomState | null;
}

export class MatchScene extends Phaser.Scene {
  private net!: NetClient;
  private myId = '';
  private mapId = 'foundry';
  private mapRenderer!: MapRenderer;
  private solids: { x: number; y: number; w: number; h: number }[] = [];

  private predictor!: Predictor;
  private localView!: PlayerView;
  private localPalette = 0;
  private remotes = new Map<string, RemoteEntry>();
  private paletteOf = new Map<string, number>();
  private namesOf = new Map<string, string>();

  private bullets = new Map<number, Phaser.GameObjects.Sprite>();
  private bulletPool: Phaser.GameObjects.Sprite[] = [];
  private grenades = new Map<number, Phaser.GameObjects.Sprite>();
  private pickupViews = new Map<number, Phaser.GameObjects.Sprite>();

  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private boomFx!: Phaser.GameObjects.Particles.ParticleEmitter;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private lastSeq = 0;
  private pendingAim = { x: 1, y: 0 };
  private pendingActions = { grenade: 0, melee: 0, reload: 0 };
  private firePressed = false;

  private latestSnap: Snapshot | null = null;
  private lastProcessedTick = -1;
  private hudTimer = 0;
  private scoresTimer = 0;
  private deathAt = 0;
  private countdownLastSec = -1;
  private ownedWeapons: WeaponId[] = ['pistol'];
  private overEmitted = false;
  private matchEnded = false;
  private pendingEvents: GameEvent[] = [];
  private feedId = 1;
  private cameraDead = false;

  constructor() {
    super('Match');
  }

  init(data: Partial<MatchSceneInit> & { ready?: boolean }): void {
    // `net` is only absent when the scene is started standalone (dev/testing).
    this.net = data.net ?? new NetClient({});
    this.myId = data.myId ?? '';
    this.mapId = data.mapId ?? 'foundry';
    this.cameraDead = false;
    this.overEmitted = false;
    this.matchEnded = false;
  }

  create(): void {
    const map = this.mapRenderer = new MapRenderer(this, this.mapId);
    this.solids = map.map.solids;

    // camera
    this.cameras.main.setBounds(0, 0, map.map.w, map.map.h);
    this.cameras.main.setZoom(1);

    // local player view (palette 0 by default; corrected on first room state)
    const spawn = map.map.spawns[0];
    this.predictor = new Predictor(spawn.x, spawn.y - C.PLAYER_H / 2, this.solids);
    this.localView = new PlayerView(this, PALETTES[0].key, 0, 'You', true);

    // pooled particle emitters
    this.sparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 60, max: 240 },
      lifespan: { min: 120, max: 320 },
      scale: { start: 1, end: 0.3 },
      alpha: { start: 1, end: 0 },
      quantity: 1,
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(20);
    this.smoke = this.add.particles(0, 0, 'smoke', {
      speedY: { min: -30, max: -8 },
      speedX: { min: -14, max: 14 },
      lifespan: { min: 400, max: 900 },
      scale: { start: 0.8, end: 1.5 },
      alpha: { start: 0.45, end: 0 },
      emitting: false,
    }).setDepth(19);
    this.boomFx = this.add.particles(0, 0, 'spark', {
      speed: { min: 120, max: 420 },
      lifespan: { min: 250, max: 600 },
      scale: { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0 },
      emitting: false,
      blendMode: Phaser.BlendModes.ADD,
      tint: [0xffd23c, 0xff9d3c, 0xfff6d8],
    }).setDepth(21);

    // input
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      up: K.UP, w: K.W, a: K.A, left: K.LEFT, d: K.D, right: K.RIGHT, space: K.SPACE,
      r: K.R, g: K.G, f: K.F, v: K.V, q: K.Q, tab: K.TAB, enter: K.ENTER,
      one: K.ONE, two: K.TWO, three: K.THREE, four: K.FOUR, five: K.FIVE, six: K.SIX,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.disableGlobalCapture();

    this.input.mouse!.disableContextMenu();
    this.input.on('pointerdown', () => {
      audio.unlock();
      if (!this.inputStateEffective().chatOpen) this.firePressed = true;
    });
    this.input.on('pointerup', () => {
      this.firePressed = false;
    });

    if (!this.anims.exists('flash_anim')) {
      this.anims.create({ key: 'flash_anim', frames: this.anims.generateFrameNumbers('flash', { frames: [0, 1, 2] }), frameRate: 30, repeat: 0 });
    }
    if (!this.anims.exists('boom_anim')) {
      this.anims.create({ key: 'boom_anim', frames: this.anims.generateFrameNumbers('boom', { frames: [0, 1, 2, 3, 4, 5] }), frameRate: 18, repeat: 0 });
    }

    // crosshair (desktop)
    this.add.image(0, 0, 'crosshair').setScrollFactor(0).setDepth(950).setName('crosshair');

    if (this.net.room) this.applyRoom(this.net.room);
    audio.startMusic();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
  }

  private inputStateEffective() {
    return inputState;
  }

  private applyRoom(room: RoomState): void {
    this.paletteOf.clear();
    this.namesOf.clear();
    room.players.forEach((p, idx) => {
      this.paletteOf.set(p.id, Math.min(idx, PALETTES.length - 1));
      this.namesOf.set(p.id, p.name);
    });
    const myIdx = this.paletteOf.get(this.myId) ?? 0;
    if (myIdx !== this.localPalette) {
      this.localPalette = myIdx;
      this.localView.destroy();
      this.localView = new PlayerView(this, PALETTES[myIdx].key, myIdx, room.players[myIdx]?.name ?? 'You', true);
    }
    // drop remote views that left
    for (const id of [...this.remotes.keys()]) {
      if (!room.players.some((p) => p.id === id)) {
        this.remotes.get(id)?.view.destroy();
        this.remotes.delete(id);
      }
    }
  }

  // ── Snapshot ingestion (called from NetClient callback via GameClient) ──

  onSnapshot(snap: Snapshot): void {
    if (snap.tick <= this.lastProcessedTick) return;
    this.lastProcessedTick = snap.tick;
    this.latestSnap = snap;
    this.pendingEvents.push(...snap.ev);
  }

  onRoomUpdate(room: RoomState): void {
    this.applyRoom(room);
  }

  // ── Main loop ──────────────────────────────────────────────────────────

  update(time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    const snap = this.latestSnap;

    if (snap) {
      this.processSnapshot(snap, time);
      this.processEvents();
    }

    this.captureInputs(dt, time);
    this.updateLocalVisuals(dt, time);
    this.updateRemotes(dt);
    this.updateProjectiles(dt);
    this.updateCamera(dt);
    this.publishHud(dt);
    this.minimapUpdate();
    void time;
  }

  // ── Snapshot application ───────────────────────────────────────────────

  private processSnapshot(snap: Snapshot, time: number): void {
    const now = this.net.serverNow();

    // players
    const seen = new Set<string>();
    for (const ps of snap.ps) {
      seen.add(ps.i);
      if (ps.i === this.myId) {
        // local: authoritative correction for the predictor
        this.predictor.correct(ps, now);
        const pal = this.paletteOf.get(ps.i) ?? 0;
        void pal;
        this.ownedWeapons = WEAPON_IDS.filter((_, i) => (ps.ob & (1 << i)) !== 0);
        if (ps.al === 0 && this.deathAt === 0) {
          this.deathAt = now;
          audio.play('death');
        } else if (ps.al === 1 && this.deathAt !== 0) {
          this.deathAt = 0;
        }
      } else {
        let entry = this.remotes.get(ps.i);
        if (!entry) {
          const pal = this.paletteOf.get(ps.i) ?? 1;
          const view = new PlayerView(this, PALETTES[pal].key, pal, this.namesOf.get(ps.i) ?? 'Player', false);
          entry = { view, buf: [], lastAim: ps.a };
          this.remotes.set(ps.i, entry);
        }
        const t = now;
        entry.buf.push({ t, x: ps.x, y: ps.y, vx: ps.vx, vy: ps.vy, aim: ps.a });
        if (entry.buf.length > 60) entry.buf.shift();
      }
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) {
        this.remotes.get(id)?.view.destroy();
        this.remotes.delete(id);
      }
    }

    // bullets
    const seenB = new Set<number>();
    for (const b of snap.bs) {
      seenB.add(b.i);
      let sp = this.bullets.get(b.i);
      if (!sp) {
        sp = this.acquireBullet(b.w);
        this.bullets.set(b.i, sp);
        sp.setPosition(b.x, b.y);
        sp.setRotation(Math.atan2(b.vy, b.vx));
      }
      sp.setPosition(b.x, b.y);
      sp.setRotation(Math.atan2(b.vy, b.vx));
      if (b.w === 'rocket') {
        this.smoke.emitParticleAt(b.x, b.y, 1);
      }
    }
    for (const id of [...this.bullets.keys()]) {
      if (!seenB.has(id)) {
        const sp = this.bullets.get(id)!;
        this.bullets.delete(id);
        sp.setVisible(false);
        this.bulletPool.push(sp);
      }
    }

    // grenades
    const seenG = new Set<number>();
    for (const g of snap.gs) {
      seenG.add(g.i);
      let sp = this.grenades.get(g.i);
      if (!sp) {
        sp = this.add.sprite(g.x, g.y, 'grenade').setDepth(15);
        this.grenades.set(g.i, sp);
      }
      sp.setPosition(g.x, g.y);
      sp.setRotation(sp.rotation + 0.35);
      sp.setAlpha(g.fu < 500 ? (Math.floor(time / 60) % 2 === 0 ? 1 : 0.5) : 1);
    }
    for (const id of [...this.grenades.keys()]) {
      if (!seenG.has(id)) {
        this.grenades.get(id)!.destroy();
        this.grenades.delete(id);
      }
    }

    // pickups
    const seenP = new Set<number>();
    for (const pk of snap.pk) {
      seenP.add(pk.i);
      let sp = this.pickupViews.get(pk.i);
      if (!sp) {
        const tex = pk.w ? 'pk_weapon' : `pk_${pk.k}`;
        sp = this.add.sprite(pk.x, pk.y, tex).setDepth(5);
        this.pickupViews.set(pk.i, sp);
        this.tweens.add({ targets: sp, y: pk.y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
    }
    for (const id of [...this.pickupViews.keys()]) {
      if (!seenP.has(id)) {
        this.tweens.killTweensOf(this.pickupViews.get(id)!);
        this.pickupViews.get(id)!.destroy();
        this.pickupViews.delete(id);
      }
    }

    void time;
  }

  private acquireBullet(w: WeaponId): Phaser.GameObjects.Sprite {
    let sp = this.bulletPool.pop();
    if (!sp) {
      sp = this.add.sprite(0, 0, w === 'rocket' ? 'rocketproj' : 'bullet').setDepth(14);
    } else {
      sp.setTexture(w === 'rocket' ? 'rocketproj' : 'bullet');
      sp.setVisible(true);
    }
    return sp;
  }

  // ── Events → effects/audio ─────────────────────────────────────────────

  private processEvents(): void {
    if (this.pendingEvents.length === 0) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const cam = this.cameras.main;
    const center = cam.midPoint;
    for (const ev of events) {
      switch (ev.t) {
        case 'shot': {
          const off = muzzleOffset(ev.w, ev.a);
          const flash = this.add.sprite(ev.x + off.x, ev.y + off.y, 'flash', 0).setDepth(16).setRotation(ev.a);
          flash.play('flash_anim');
          flash.once('animationcomplete', () => flash.destroy());
          const dist = Phaser.Math.Distance.Between(center.x, center.y, ev.x, ev.y);
          const vol = Math.max(0.08, 1 - dist / 1300);
          audio.play(`shoot_${ev.w}`, vol);
          break;
        }
        case 'imp': {
          this.sparks.emitParticleAt(ev.x, ev.y, 3);
          const dist = Phaser.Math.Distance.Between(center.x, center.y, ev.x, ev.y);
          if (dist < 900) audio.play('hit', 0.4 * (1 - dist / 900));
          break;
        }
        case 'hit': {
          this.sparks.emitParticleAt(ev.x, ev.y, 5);
          if (ev.i === this.myId) {
            bus.emit('damage', { amount: ev.dmg });
            audio.play('hurt', 0.9);
            if (ev.dmg >= 30) cam.shake(90, 0.0035);
          } else if (ev.by === this.myId) {
            audio.play('hit', 0.7);
            this.showHitmarker(ev.x, ev.y);
          }
          break;
        }
        case 'boom': {
          const dist = Phaser.Math.Distance.Between(center.x, center.y, ev.x, ev.y);
          const boom = this.add.sprite(ev.x, ev.y, 'boom', 0).setDepth(22).setScale(ev.big ? 1.15 : 1);
          boom.play('boom_anim');
          boom.once('animationcomplete', () => boom.destroy());
          this.boomFx.emitParticleAt(ev.x, ev.y, ev.big ? 26 : 18);
          this.smoke.emitParticleAt(ev.x, ev.y, 5);
          const falloff = Math.max(0, 1 - dist / 1400);
          audio.play('explosion', Math.max(0.1, falloff));
          if (falloff > 0.05) {
            const intensity = Math.min(0.012, 0.003 + falloff * 0.01) * this.shakeScale();
            cam.shake(140 + falloff * 160, intensity);
          }
          break;
        }
        case 'kill': {
          const killerName = ev.k ? this.namesOf.get(ev.k) ?? 'Someone' : 'The arena';
          const victimName = this.namesOf.get(ev.v) ?? 'A player';
          const wpnName = ev.w === 'grenade' ? 'grenade' : ev.w === 'melee' ? 'melee' : ev.w === 'void' ? 'the void' : WEAPONS[ev.w]?.name ?? ev.w;
          bus.emit('feed', { id: this.feedId++, text: `${killerName}  ⟶  ${victimName}  (${wpnName})` });
          if (ev.k === this.myId && ev.k !== ev.v) audio.play('kill', 0.8);
          break;
        }
        case 'nade': {
          audio.play('nade_throw', 0.6);
          break;
        }
        case 'melee': {
          const dist = Phaser.Math.Distance.Between(center.x, center.y, ev.x, ev.y);
          audio.play('melee', Math.max(0.1, 1 - dist / 900));
          break;
        }
        case 'spawn': {
          this.sparks.emitParticleAt(ev.x, ev.y, 6);
          if (ev.i === this.myId) audio.play('pickup', 0.7);
          break;
        }
        case 'reload': {
          const p = this.latestSnap?.ps.find((x) => x.i === ev.i);
          void p;
          audio.play('reload', 0.8);
          break;
        }
        case 'pk': {
          this.sparks.emitParticleAt(ev.x, ev.y, 8);
          if (ev.p === this.myId) audio.play('pickup', 0.9);
          break;
        }
        case 'over': {
          if (!this.overEmitted) {
            this.overEmitted = true;
            this.matchEnded = true;
          }
          break;
        }
        case 'sys': {
          if (ev.m === 'GO') audio.play('go', 1);
          break;
        }
        case 'conn':
        case 'host':
        case 'chat':
          break;
      }
    }
  }

  private shakeScale(): number {
    return 1;
  }

  private showHitmarker(x: number, y: number): void {
    const hm = this.add.image(x, y, 'hitmarker').setDepth(30).setAlpha(0.9);
    this.tweens.add({ targets: hm, alpha: 0, duration: 180, onComplete: () => hm.destroy() });
  }

  // ── Input capture + prediction ─────────────────────────────────────────

  private captureInputs(dt: number, time: number): void {
    if (inputState.chatOpen || this.matchEnded) {
      inputState.fire = false;
      inputState.jump = false;
      inputState.jet = false;
      inputState.mx = 0;
    }
    const k = this.keys;
    const chatOpen = inputState.chatOpen;
    const left = !chatOpen && (k.a?.isDown || k.left?.isDown);
    const right = !chatOpen && (k.d?.isDown || k.right?.isDown);
    const jump = !chatOpen && !inputState.desktop && inputState.jump
      ? false
      : !chatOpen && (k.w?.isDown || k.up?.isDown || k.space?.isDown);
    const jet = !chatOpen && (k.space?.isDown || (!inputState.desktop && inputState.jet));
    // NOTE: mobile jet is the dedicated button; desktop jet uses SPACE too.
    const fire = !chatOpen && (this.firePressed || (!inputState.desktop && inputState.fire));

    const mx = chatOpen ? 0 : left && !right ? -1 : right && !left ? 1 : inputState.desktop ? 0 : Math.sign(inputState.mx);

    // action edges
    if (!chatOpen) {
      if (Phaser.Input.Keyboard.JustDown(k.r)) this.pendingActions.reload++;
      if (Phaser.Input.Keyboard.JustDown(k.g)) this.pendingActions.grenade++;
      if (Phaser.Input.Keyboard.JustDown(k.f) || Phaser.Input.Keyboard.JustDown(k.v)) this.pendingActions.melee++;
      // mobile one-shot actions queued by the React touch controls
      if (inputState.queueReload > 0) { inputState.queueReload--; this.pendingActions.reload++; }
      if (inputState.queueGrenade > 0) { inputState.queueGrenade--; this.pendingActions.grenade++; }
      if (inputState.queueMelee > 0) { inputState.queueMelee--; this.pendingActions.melee++; }
      if (Phaser.Input.Keyboard.JustDown(k.enter)) {
        bus.emit('ui', { action: 'chat-open' });
      }
      if (Phaser.Input.Keyboard.JustDown(k.tab)) {
        inputState.scoreboard = true;
        bus.emit('scoreboard', { open: true });
      } else if (k.tab && !k.tab.isDown && inputState.scoreboard) {
        inputState.scoreboard = false;
        bus.emit('scoreboard', { open: false });
      }
      if (Phaser.Input.Keyboard.JustDown(k.q)) this.cycleWeapon(1);
      const digits = ['one', 'two', 'three', 'four', 'five', 'six'];
      digits.forEach((keyName, i) => {
        if (Phaser.Input.Keyboard.JustDown(k[keyName])) this.selectWeapon(i);
      });
    }

    // aim
    const localX = this.predictor.displayX;
    const localY = this.predictor.displayY;
    if (inputState.desktop && !chatOpen && this.input.activePointer) {
      const p = this.input.activePointer;
      const wx = p.worldX;
      const wy = p.worldY;
      const dx = wx - localX;
      const dy = wy - localY;
      if (dx * dx + dy * dy > 1) {
        this.pendingAim = { x: dx, y: dy };
      }
    } else if (!inputState.desktop && !chatOpen) {
      const ax = inputState.aimX;
      const ay = inputState.aimY;
      if (ax * ax + ay * ay > 0.01) this.pendingAim = { x: ax, y: ay };
    }

    // fixed 60 Hz input frames
    this.acc += dt;
    let guard = 0;
    while (this.acc >= C.INPUT_DT && guard++ < 6) {
      this.acc -= C.INPUT_DT;
      const grenade = this.pendingActions.grenade > 0;
      if (grenade) this.pendingActions.grenade--;
      const melee = this.pendingActions.melee > 0;
      if (melee) this.pendingActions.melee--;
      const reload = this.pendingActions.reload > 0;
      if (reload) this.pendingActions.reload--;
      const aimLen = Math.sqrt(this.pendingAim.x ** 2 + this.pendingAim.y ** 2) || 1;
      const frame = {
        seq: ++this.lastSeq,
        fl: flagsFor({
          jump: jump || (!inputState.desktop && inputState.jump),
          jet: jet || (!inputState.desktop && inputState.jet),
          fire,
          grenade,
          melee,
          reload,
        }),
        mx: (mx === -1 ? -1 : mx === 1 ? 1 : 0) as -1 | 0 | 1,
        ax: this.pendingAim.x / aimLen,
        ay: this.pendingAim.y / aimLen,
      };
      this.net.sendInputFrame(frame);
      const vis = this.predictor.step(frame, time);
      if (vis.jumped) audio.play('jump', 0.6);
      if (vis.jetting) audio.startJet();
      else audio.stopJet();
      if (vis.grenadeEdge) void 0;
    }
    if (this.acc > 0.25) this.acc = 0;
  }

  private cycleWeapon(dir: 1 | -1): void {
    const owned = this.ownedWeapons;
    if (owned.length < 2) return;
    const cur = this.latestSnap?.ps.find((p) => p.i === this.myId)?.w ?? 'pistol';
    let idx = owned.indexOf(cur);
    idx = (idx + dir + owned.length) % owned.length;
    this.net.switchWeapon(owned[idx]);
    audio.play('switch', 0.8);
  }

  private selectWeapon(i: number): void {
    const w = WEAPON_IDS[i];
    if (!w || !this.ownedWeapons.includes(w)) return;
    const cur = this.latestSnap?.ps.find((p) => p.i === this.myId)?.w;
    if (cur === w) return;
    this.net.switchWeapon(w);
    audio.play('switch', 0.8);
  }

  // ── Visual updates ─────────────────────────────────────────────────────

  private updateLocalVisuals(dt: number, time: number): void {
    const snap = this.latestSnap;
    const mine = snap?.ps.find((p) => p.i === this.myId);
    this.predictor.update(dt);
    const x = this.predictor.displayX;
    const y = this.predictor.displayY;
    const vx = this.predictor.state.body.vx;
    const vy = this.predictor.state.body.vy;
    const onGround = this.predictor.state.onGround;
    const jetting = this.predictor.lastVisual.jetting;
    const pal = PALETTES[this.localPalette];

    // aim for rendering: keep pendingAim angle
    const aim = Math.atan2(this.pendingAim.y, this.pendingAim.x);

    const alive = mine ? mine.al === 1 : true;
    this.localView.setVisible(alive);
    if (alive) {
      let anim = 'idle';
      if (jetting) anim = 'jet';
      else if (!onGround) anim = vy < 0 ? 'jump' : 'fall';
      else if (Math.abs(vx) > 30) anim = 'run';
      this.localView.setAnim(anim);
      const hp = mine?.hp ?? 100;
      const weapon = mine?.w ?? 'pistol';
      const reloading = (mine?.rl ?? 0) > 0;
      const reloadFrac = reloading ? 1 - (mine!.rl / WEAPONS[weapon].reloadMs) : 0;
      this.localView.render(x, y, aim, hp, true, weapon, reloading, reloadFrac);
      this.localView.flame.setVisible(jetting);
      this.localView.flame.setFrame(jetting ? Math.floor(time / 50) % 2 : 0);
      if (jetting && Math.random() < 0.3) {
        this.smoke.emitParticleAt(x - 7, y + 16, 1);
      }
    } else {
      this.localView.flame.setVisible(false);
      audio.stopJet();
    }
    void pal;
    void dt;
  }

  private updateRemotes(dt: number): void {
    const now = this.net.serverNow();
    const renderT = now - C.INTERP_DELAY_MS;
    for (const [id, entry] of this.remotes) {
      const buf = entry.buf;
      if (buf.length === 0) continue;
      // find bracketing pair
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderT && buf[i + 1].t >= renderT) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      let x: number;
      let y: number;
      let aim: number;
      if (renderT >= b.t) {
        // extrapolate a little using velocity
        const extra = Math.min(120, renderT - b.t);
        x = b.x + b.vx * (extra / 1000);
        y = b.y + b.vy * (extra / 1000);
        aim = b.aim;
      } else {
        const span = Math.max(1, b.t - a.t);
        const t = Phaser.Math.Clamp((renderT - a.t) / span, 0, 1);
        x = Phaser.Math.Linear(a.x, b.x, t);
        y = Phaser.Math.Linear(a.y, b.y, t);
        aim = Phaser.Math.Angle.RotateTo(entry.lastAim, b.aim, dt * 12);
      }
      entry.lastAim = aim;
      const mine = this.latestSnap?.ps.find((p) => p.i === id);
      const alive = mine ? mine.al === 1 : true;
      entry.view.setVisible(alive);
      if (alive && mine) {
        const anim = mine.vy < -80 ? 'jet' : !mine.al ? 'idle' : Math.abs(mine.vy) > 260 && Math.abs(mine.vx) < 40 ? (mine.vy < 0 ? 'jump' : 'fall') : Math.abs(mine.vx) > 30 ? 'run' : 'idle';
        entry.view.setAnim(anim);
        const weapon = mine.w;
        const reloading = mine.rl > 0;
        const reloadFrac = reloading ? 1 - mine.rl / WEAPONS[weapon].reloadMs : 0;
        entry.view.render(x, y, aim, mine.hp, true, weapon, reloading, reloadFrac);
        entry.view.flame.setVisible(mine.vy < -80);
      } else {
        entry.view.flame.setVisible(false);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    void dt;
  }

  private updateCamera(dt: number): void {
    if (this.cameraDead) return;
    const cam = this.cameras.main;
    const target = new Phaser.Math.Vector2(this.predictor.displayX, this.predictor.displayY - 40);
    const cur = cam.midPoint;
    const lerp = 1 - Math.exp(-dt * 8);
    cam.centerOn(cur.x + (target.x - cur.x) * lerp, cur.y + (target.y - cur.y) * lerp);
  }

  private minimapUpdate(): void {
    const snap = this.latestSnap;
    if (!snap) return;
    const players = snap.ps
      .filter((p) => p.al === 1)
      .map((p) => ({
        x: p.x,
        y: p.y,
        alive: p.al === 1,
        palette: this.paletteOf.get(p.i) ?? 1,
        isLocal: p.i === this.myId,
      }));
    bus.emit('minimap', { players });
  }

  // ── HUD publishing ─────────────────────────────────────────────────────

  private publishHud(dt: number): void {
    this.hudTimer += dt;
    this.scoresTimer += dt;
    const snap = this.latestSnap;
    const mine = snap?.ps.find((p) => p.i === this.myId);
    if (this.hudTimer >= 0.1 && mine) {
      this.hudTimer = 0;
      const w = WEAPONS[mine.w];
      const timeLeft = snap?.matchEndsAt ? Math.max(0, (snap.matchEndsAt - this.net.serverNow())) : 0;
      bus.emit('hud', {
        hp: mine.hp,
        fuel: this.predictor.state.fuel,
        weapon: mine.w,
        weaponName: w.name,
        mag: mine.m,
        reserve: mine.r,
        alive: mine.al === 1,
        grenades: mine.na,
        respawnInMs: mine.al === 0 ? Math.max(0, C.RESPAWN_MS - (this.net.serverNow() - this.deathAt)) : 0,
        timeLeftMs: timeLeft,
        kills: mine.k,
        deaths: mine.d,
        reloading: mine.rl > 0,
        reloadMs: w.reloadMs,
        reloadRemainingMs: mine.rl,
        owned: [...this.ownedWeapons],
      });
    }
    if (this.scoresTimer >= 0.5 && snap) {
      this.scoresTimer = 0;
      bus.emit('scores', {
        players: snap.ps.map((p) => ({
          id: p.i,
          name: this.namesOf.get(p.i) ?? 'Player',
          kills: p.k,
          deaths: p.d,
          connected: true,
        })),
        myId: this.myId,
        killTarget: 10,
      });
      if (snap.phase === 'over' && !this.overEmitted) {
        this.overEmitted = true;
        this.matchEnded = true;
      }
    }
    // countdown beeps
    if (snap?.phase === 'countdown' && snap.time) {
      void snap;
    }
  }

  /** Countdown tick sounds, driven by room phase updates. */
  onCountdown(countdownAtMs: number): void {
    const remaining = Math.max(0, countdownAtMs - this.net.serverNow());
    const sec = Math.ceil(remaining / 1000);
    if (sec !== this.countdownLastSec && sec > 0 && sec <= 3) {
      this.countdownLastSec = sec;
      audio.play('beep', 1);
    }
  }

  private shutdown(): void {
    audio.stopJet();
    audio.stopMusic();
    for (const r of this.remotes.values()) r.view.destroy();
    this.remotes.clear();
    for (const b of this.bullets.values()) b.destroy();
    this.bullets.clear();
    this.bulletPool = [];
    for (const g of this.grenades.values()) g.destroy();
    this.grenades.clear();
    for (const p of this.pickupViews.values()) p.destroy();
    this.pickupViews.clear();
    this.pendingEvents = [];
  }
}
