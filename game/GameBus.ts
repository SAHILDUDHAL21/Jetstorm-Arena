/**
 * Tiny typed event bus bridging the Phaser game and the React UI.
 * React never touches game logic — it renders state published here and
 * feeds controls into InputState.
 */
import type { WeaponId } from '../shared/types';

export type BusEvents = {
  hud: {
    hp: number;
    fuel: number;
    weapon: WeaponId;
    weaponName: string;
    mag: number;
    reserve: number;
    alive: boolean;
    grenades: number;
    respawnInMs: number;
    timeLeftMs: number;
    kills: number;
    deaths: number;
    reloading: boolean;
    reloadMs: number;
    reloadRemainingMs: number;
    owned: WeaponId[];
  };
  scores: {
    players: { id: string; name: string; kills: number; deaths: number; connected: boolean }[];
    myId: string;
    killTarget: number;
  };
  phase: { phase: string; countdownAtMs?: number; matchEndsAtMs?: number };
  over: {
    winner: string | null;
    reason: string;
    players: { id: string; name: string; kills: number; deaths: number }[];
    myId: string;
  };
  feed: { id: number; text: string };
  chat: { from: string; text: string; sys?: boolean };
  notice: { text: string };
  damage: { amount: number };
  net: { status: 'connecting' | 'online' | 'offline'; ping: number | null };
  minimap: {
    players: { x: number; y: number; alive: boolean; palette: number; isLocal: boolean }[];
  };
  ui: { action: 'chat-open' | 'leave' | 'scoreboard-toggle' };
  scoreboard: { open: boolean };
};

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

export class GameBus {
  private handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(k: K, h: Handler<K>): () => void {
    let set = this.handlers.get(k);
    if (!set) {
      set = new Set();
      this.handlers.set(k, set);
    }
    set.add(h as Handler<never>);
    return () => {
      set!.delete(h as Handler<never>);
    };
  }

  emit<K extends keyof BusEvents>(k: K, payload: BusEvents[K]): void {
    const set = this.handlers.get(k);
    if (set) for (const h of [...set]) (h as Handler<K>)(payload);
  }
}

export const bus = new GameBus();
