'use client';

/** Animated Phaser starfield behind the main menu. */
import { useEffect, useRef } from 'react';
import { createMenuGame } from '@/game/Game';

export function MenuBackground() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const game = createMenuGame(el);
    return () => {
      game.destroy(true, false);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="game-mount pointer-events-none absolute inset-0 z-0"
      style={{ opacity: 0.9 }}
    />
  );
}
