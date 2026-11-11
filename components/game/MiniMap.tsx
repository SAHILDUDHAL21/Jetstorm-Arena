'use client';

/**
 * MiniMap — React-rendered arena overview shown in the HUD below the Leave
 * button. The base layout is drawn once from the shared map data; player dots
 * stream in over the GameBus ('minimap' event, published by MatchScene) and
 * are painted straight onto the canvas — no React re-render per frame.
 *
 * Replaces the old Phaser-anchored minimap, which could be cropped off-screen
 * by the ENVELOP-scaled canvas on non-16:9 windows.
 */
import { useEffect, useRef } from 'react';
import { getMap } from '@/shared/maps';
import { bus } from '@/game/GameBus';
import type { BusEvents } from '@/game/GameBus';

const MM_W = 140;
const MM_H = Math.round((MM_W * 1800) / 3200); // world aspect (3200×1800)

// Same mains as PALETTES in PreloadScene — duplicated here so the React HUD
// never needs to pull the Phaser bundle.
const DOT_COLORS = ['#e04856', '#3d7de0', '#e0913d', '#3dc985'];

type MinimapPlayers = BusEvents['minimap']['players'];

export function MiniMap({ mapId }: { mapId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Base layout: drawn once per mapId.
  useEffect(() => {
    if (!mapId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const map = getMap(mapId);
    const sx = MM_W / map.w;
    const sy = MM_H / map.h;

    ctx.clearRect(0, 0, MM_W, MM_H);
    ctx.fillStyle = 'rgba(20,12,5,0.72)';
    ctx.fillRect(0, 0, MM_W, MM_H);
    ctx.strokeStyle = 'rgba(190,155,105,0.5)';
    ctx.strokeRect(0.5, 0.5, MM_W - 1, MM_H - 1);
    ctx.fillStyle = 'rgba(160,125,80,0.55)';
    for (const r of map.solids) {
      if (r.w >= map.w - 200 && r.y === 0) continue; // top border
      if (r.h >= map.h - 200) continue; // side borders
      ctx.fillRect(r.x * sx, r.y * sy, Math.max(1, r.w * sx), Math.max(1, r.h * sy));
    }
  }, [mapId]);

  // Player dots: painted directly on the canvas on every bus event.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawDots = ({ players }: BusEvents['minimap']) => {
      const map = getMap(mapId || 'foundry');
      const sx = MM_W / map.w;
      const sy = MM_H / map.h;
      ctx.clearRect(0, 0, MM_W, MM_H);
      // re-draw the base under the dots (cheap: a few rects)
      ctx.fillStyle = 'rgba(20,12,5,0.72)';
      ctx.fillRect(0, 0, MM_W, MM_H);
      ctx.strokeStyle = 'rgba(190,155,105,0.5)';
      ctx.strokeRect(0.5, 0.5, MM_W - 1, MM_H - 1);
      ctx.fillStyle = 'rgba(160,125,80,0.55)';
      for (const r of map.solids) {
        if (r.w >= map.w - 200 && r.y === 0) continue;
        if (r.h >= map.h - 200) continue;
        ctx.fillRect(r.x * sx, r.y * sy, Math.max(1, r.w * sx), Math.max(1, r.h * sy));
      }
      for (const p of players as MinimapPlayers) {
        const x = p.x * sx;
        const y = p.y * sy;
        if (p.isLocal) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#140c05';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle = DOT_COLORS[p.palette % DOT_COLORS.length] ?? '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    return bus.on('minimap', drawDots);
  }, [mapId]);

  if (!mapId) return null;

  return (
    <div
      className="panel rounded-lg p-1 pointer-events-none"
      style={{ width: MM_W + 8, boxShadow: '0 2px 10px -4px #00000088' }}
    >
      <canvas ref={canvasRef} width={MM_W} height={MM_H} className="block rounded" />
      <div
        className="text-center text-[9px] font-bold uppercase tracking-[0.16em] leading-tight truncate"
        style={{ color: 'var(--ink-dim)' }}
      >
        {getMap(mapId).name}
      </div>
    </div>
  );
}
