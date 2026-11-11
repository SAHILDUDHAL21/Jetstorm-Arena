'use client';

/** TAB / button toggled live scoreboard. */
import { useState } from 'react';
import { inputState } from '@/game/input/InputState';
import { useBus } from './useBus';
import type { BusEvents } from '@/game/GameBus';

const PALETTE_COLORS = ['#ff4d5e', '#3fa7ff', '#ffb43c', '#37d67a'];

export function Scoreboard() {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<BusEvents['scores'] | null>(null);

  useBus('scoreboard', (s) => setOpen(s.open));
  useBus('scores', setScores);
  useBus('ui', (u) => {
    if (u.action === 'scoreboard-toggle') {
      setOpen((o) => {
        inputState.scoreboard = !o;
        return !o;
      });
    }
  });

  if (!open || !scores) return null;
  const sorted = [...scores.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none" style={{ background: '#1a120b88' }}>
      <div className="panel w-full max-w-md p-5 pointer-events-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="panel-title">Scoreboard</h2>
          <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>first to {scores.killTarget}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
              <th className="pb-1.5 font-bold">Player</th>
              <th className="pb-1.5 font-bold text-right">Kills</th>
              <th className="pb-1.5 font-bold text-right">Deaths</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={p.id}
                className="border-t"
                style={{
                  borderColor: 'var(--line)',
                  opacity: p.connected ? 1 : 0.4,
                  color: p.id === scores.myId ? 'var(--accent)' : 'var(--ink)',
                  fontWeight: p.id === scores.myId ? 700 : 400,
                }}
              >
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE_COLORS[i % 4] }} />
                    {p.name}{p.id === scores.myId ? ' (you)' : ''}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.kills}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--ink-dim)' }}>{p.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
