/**
 * AudioSystem — 100% synthesized sound (Web Audio API). Every effect and the
 * ambient music loop are generated procedurally, so the game ships with no
 * audio files and no licensing concerns.
 */
import { loadSettings } from '../../lib/client/settings';

type Ctx = AudioContext;

export class AudioSystem {
  private ctx: Ctx | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private jetSource: AudioBufferSourceNode | null = null;
  private jetGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private settings = loadSettings();
  private unlocked = false;

  unlock(): void {
    if (this.unlocked) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.applyVolumes();
    this.unlocked = true;
    void this.ctx.resume().catch(() => {});
    // pre-render 1s of white noise for reuse
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    this.applyVolumes();
  }

  setSettings(next: Partial<typeof this.settings>): void {
    this.settings = { ...this.settings, ...next };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) return;
    const m = this.settings.muted ? 0 : this.settings.master;
    this.masterGain.gain.value = m;
    this.sfxGain.gain.value = this.settings.sfx;
    this.musicGain.gain.value = this.settings.music * 0.5;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private noise(dur: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start(this.now(), Math.random() * 0.5, dur + 0.05);
    return src;
  }

  private env(g: GainNode, t0: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, dur: number, peak: number,
    dest: AudioNode | null = null, delay = 0,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    this.env(g, t0, 0.005, peak, dur);
    osc.connect(g);
    g.connect(dest ?? this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
  }

  private noiseHit(
    dur: number, peak: number, filterType: BiquadFilterType, f: number, f1: number,
    dest: AudioNode | null = null, delay = 0,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.now() + delay;
    const src = this.noise(dur);
    if (!src) return;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(Math.max(30, f), t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, 0.004, peak, dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest ?? this.sfxGain);
    src.stop(t0 + dur + 0.1);
  }

  /** Fire one of the procedural SFX. */
  play(name: string, vol = 1): void {
    if (!this.unlocked || !this.ctx || this.settings.muted) return;
    switch (name) {
      case 'shoot_pistol':
        this.tone('square', 420, 90, 0.09, 0.16 * vol);
        this.noiseHit(0.06, 0.2 * vol, 'bandpass', 2400, 800);
        break;
      case 'shoot_smg':
        this.tone('square', 520, 140, 0.06, 0.11 * vol);
        this.noiseHit(0.05, 0.14 * vol, 'bandpass', 2800, 1200);
        break;
      case 'shoot_rifle':
        this.tone('sawtooth', 380, 70, 0.1, 0.15 * vol);
        this.noiseHit(0.07, 0.2 * vol, 'bandpass', 2000, 700);
        break;
      case 'shoot_shotgun':
        this.noiseHit(0.22, 0.4 * vol, 'lowpass', 1400, 200);
        this.tone('sawtooth', 180, 40, 0.18, 0.22 * vol);
        break;
      case 'shoot_sniper':
        this.noiseHit(0.16, 0.35 * vol, 'highpass', 1200, 3000);
        this.tone('sawtooth', 260, 40, 0.3, 0.24 * vol);
        this.noiseHit(0.4, 0.12 * vol, 'lowpass', 500, 80);
        break;
      case 'shoot_rocket':
        this.noiseHit(0.5, 0.3 * vol, 'lowpass', 300, 2200);
        this.tone('sawtooth', 90, 240, 0.4, 0.12 * vol);
        break;
      case 'reload':
        this.noiseHit(0.03, 0.2 * vol, 'bandpass', 2000, 1400);
        this.tone('square', 700, 500, 0.03, 0.08 * vol);
        this.noiseHit(0.04, 0.25 * vol, 'bandpass', 1600, 900, null, 0.18);
        this.tone('square', 500, 320, 0.05, 0.1 * vol, null, 0.18);
        break;
      case 'hit':
        this.tone('square', 900, 500, 0.04, 0.14 * vol);
        this.noiseHit(0.03, 0.12 * vol, 'highpass', 3000, 5000);
        break;
      case 'hurt':
        this.tone('sawtooth', 200, 60, 0.16, 0.22 * vol);
        this.noiseHit(0.1, 0.16 * vol, 'lowpass', 800, 200);
        break;
      case 'kill':
        this.tone('square', 660, 660, 0.08, 0.14 * vol);
        this.tone('square', 440, 330, 0.16, 0.14 * vol, null, 0.08);
        break;
      case 'death':
        this.tone('sawtooth', 300, 40, 0.7, 0.22 * vol);
        this.noiseHit(0.5, 0.14 * vol, 'lowpass', 900, 100);
        break;
      case 'jump':
        this.tone('sine', 260, 520, 0.12, 0.1 * vol);
        break;
      case 'land':
        this.noiseHit(0.05, 0.1 * vol, 'lowpass', 500, 150);
        break;
      case 'melee':
        this.noiseHit(0.12, 0.26 * vol, 'bandpass', 400, 2400);
        break;
      case 'nade_throw':
        this.noiseHit(0.15, 0.14 * vol, 'bandpass', 600, 1800);
        break;
      case 'bounce':
        this.tone('sine', 240, 120, 0.07, 0.14 * vol);
        break;
      case 'explosion':
        this.noiseHit(0.65, 0.55 * vol, 'lowpass', 900, 60);
        this.tone('sine', 120, 28, 0.55, 0.5 * vol);
        this.noiseHit(0.25, 0.3 * vol, 'highpass', 2000, 4000);
        break;
      case 'pickup':
        this.tone('square', 660, 660, 0.07, 0.1 * vol);
        this.tone('square', 990, 990, 0.12, 0.1 * vol, null, 0.07);
        break;
      case 'switch':
        this.noiseHit(0.04, 0.16 * vol, 'bandpass', 1800, 1000);
        this.tone('square', 400, 300, 0.04, 0.07 * vol, null, 0.03);
        break;
      case 'click':
        this.tone('square', 900, 700, 0.03, 0.08 * vol);
        break;
      case 'beep':
        this.tone('square', 440, 440, 0.12, 0.12 * vol);
        break;
      case 'go':
        this.tone('square', 880, 880, 0.35, 0.14 * vol);
        this.tone('sine', 1320, 1320, 0.35, 0.08 * vol);
        break;
      case 'victory': {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => this.tone('square', f, f, 0.18, 0.12 * vol, null, i * 0.14));
        break;
      }
      case 'defeat': {
        const notes = [392, 330, 262, 196];
        notes.forEach((f, i) => this.tone('sawtooth', f, f * 0.97, 0.2, 0.1 * vol, null, i * 0.16));
        break;
      }
      default:
        break;
    }
  }

  /** Looping jetpack thrust noise. */
  startJet(): void {
    if (!this.unlocked || !this.ctx || !this.sfxGain || this.jetSource || this.settings.muted) return;
    const src = this.noise(1e6);
    if (!src) return;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 420;
    filt.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.now());
    g.gain.linearRampToValueAtTime(0.16, this.now() + 0.05);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxGain);
    this.jetSource = src;
    this.jetGain = g;
  }

  stopJet(): void {
    if (!this.jetSource || !this.jetGain || !this.ctx) return;
    const t = this.now();
    try {
      this.jetGain.gain.cancelScheduledValues(t);
      this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t);
      this.jetGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      this.jetSource.stop(t + 0.2);
    } catch {
      /* already stopped */
    }
    this.jetSource = null;
    this.jetGain = null;
  }

  /** Generative ambient loop: slow pad + sparse pentatonic plucks. */
  startMusic(): void {
    if (!this.unlocked || !this.ctx || !this.musicGain || this.musicTimer) return;
    const ctx = this.ctx;
    const padA = ctx.createOscillator();
    const padB = ctx.createOscillator();
    const padGain = ctx.createGain();
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 700;
    padA.type = 'triangle';
    padB.type = 'triangle';
    padA.frequency.value = 110;
    padB.frequency.value = 110 * 1.005;
    padGain.gain.value = 0.05;
    padA.connect(padFilter);
    padB.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(this.musicGain);
    padA.start();
    padB.start();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(padFilter.frequency);
    lfo.start();
    const chords = [
      [110, 130.81, 164.81],
      [87.31, 110, 130.81],
      [98, 123.47, 146.83],
      [82.41, 98, 123.47],
    ];
    let step = 0;
    const pent = [220, 261.63, 293.66, 329.63, 392, 440];
    const pluck = (freq: number, t: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(g);
      g.connect(this.musicGain!);
      osc.start(t);
      osc.stop(t + 1.3);
    };
    const tick = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.05;
      const chord = chords[step % chords.length];
      padA.frequency.setTargetAtTime(chord[0], t, 0.4);
      padB.frequency.setTargetAtTime(chord[1] * 1.005, t, 0.4);
      if (Math.random() < 0.8) pluck(chord[2] * 2, t);
      if (Math.random() < 0.5) pluck(pent[Math.floor(Math.random() * pent.length)], t + 0.5);
      step++;
    };
    tick();
    this.musicTimer = setInterval(tick, 4000);
  }

  stopMusic(): void {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }
}

export const audio = new AudioSystem();
