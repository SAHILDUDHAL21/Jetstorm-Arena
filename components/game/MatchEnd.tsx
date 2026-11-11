'use client';

/** Post-match results overlay with host rematch controls. */
import type { MatchResult } from '@/shared/types';

export function MatchEnd({
  result, isHost, onRematch, onLeave,
}: {
  result: MatchResult;
  isHost: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const sorted = [...result.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const winner = result.players.find((p) => p.id === result.winner);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-4" style={{ background: '#1a120bcc' }}>
      <div className="panel w-full max-w-md p-6">
        <div className="text-center">
          <div className="panel-title mb-1">Match over · {result.reason === 'time' ? 'time limit' : 'kill target reached'}</div>
          <div
            className="text-3xl font-black title-glow"
            style={{ color: 'var(--accent-2)' }}
          >
            {winner ? `${winner.name} wins!` : 'Draw!'}
          </div>
        </div>

        <table className="w-full text-sm mt-5">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
              <th className="pb-1.5 font-bold">#</th>
              <th className="pb-1.5 font-bold">Player</th>
              <th className="pb-1.5 font-bold text-right">Kills</th>
              <th className="pb-1.5 font-bold text-right">Deaths</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-1.5 tabular-nums" style={{ color: 'var(--ink-dim)' }}>{i + 1}</td>
                <td className="py-1.5 font-semibold" style={{ color: p.id === result.winner ? 'var(--accent-2)' : 'var(--ink)' }}>
                  {p.name}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.kills}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--ink-dim)' }}>{p.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex flex-wrap gap-2.5 justify-center">
          {isHost ? (
            <>
              <button className="btn btn-primary" onClick={onRematch}>🔁 Rematch</button>
              <button className="btn" onClick={onLeave}>🏁 Back to menu</button>
            </>
          ) : (
            <>
              <span className="self-center text-sm pulse" style={{ color: 'var(--ink-dim)' }}>
                Waiting for the host to rematch…
              </span>
              <button className="btn btn-danger" onClick={onLeave}>Leave</button>
            </>
          )}
        </div>
        <p className="mt-3 text-center text-xs" style={{ color: 'var(--ink-dim)' }}>
          Everyone returns to the lobby automatically in 20 seconds.
        </p>
      </div>
    </div>
  );
}
