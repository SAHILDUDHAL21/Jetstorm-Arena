/**
 * Phaser game factory. Keeps React out of the simulation loop: React mounts
 * a div, we boot the engine here; all gameplay lives inside the scenes.
 *
 * Init data for MatchScene travels through the per-game `registry`
 * (available synchronously after construction, read by PreloadScene).
 */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MatchScene, type MatchSceneInit } from './scenes/MatchScene';
import { MenuScene } from './scenes/MenuScene';
import type { NetClient } from './net/NetClient';
import type { RoomState } from '../shared/types';

export const VIEW_W = 1280;
export const VIEW_H = 720;

export interface MatchGameHandle {
  game: Phaser.Game;
  /** Resolves with the Match scene once the scene manager has booted it. */
  whenMatch: Promise<MatchScene>;
  destroy(): void;
}

function baseConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: '#1a120b',
    scale: {
      // Cover the whole parent edge-to-edge (no letterbox gaps); the fixed
      // 1280×720 game size is preserved and overflow is cropped symmetrically.
      mode: Phaser.Scale.ENVELOP,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: VIEW_W,
      height: VIEW_H,
    },
    audio: { noAudio: true },
    banner: false,
  };
}

/** Boot the full match pipeline: Boot → Preload (procedural art) → Match. */
export function createMatchGame(
  parent: HTMLElement,
  net: NetClient,
  myId: string,
  mapId: string,
  room: RoomState | null,
): MatchGameHandle {
  const game = new Phaser.Game({
    ...baseConfig(parent),
    scene: [BootScene, PreloadScene, MatchScene],
  });
  // The Match scene reads this at the end of PreloadScene.create().
  game.registry.set('matchInit', { net, myId, mapId, room } satisfies MatchSceneInit);

  // Scene instances exist once the manager's bootQueue has run (on game READY).
  let match: MatchScene | null = null;
  let resolveMatch!: (m: MatchScene) => void;
  const whenMatch = new Promise<MatchScene>((res) => (resolveMatch = res));
  const hunt = setInterval(() => {
    const m = game.scene.getScene('Match');
    if (m) {
      clearInterval(hunt);
      match = m as MatchScene;
      resolveMatch(match);
    }
  }, 16);

  return {
    game,
    whenMatch,
    destroy() {
      clearInterval(hunt);
      game.destroy(true, false);
    },
  };
}

/** Animated menu background (self-contained starfield scene). */
export function createMenuGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    ...baseConfig(parent),
    scene: [MenuScene],
  });
}

export type { MatchSceneInit };
