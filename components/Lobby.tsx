'use client';

/** Lobby view: roster, readiness, host controls, chat. */
import { getMap } from '@/shared/maps';
import type { RoomState } from '@/shared/types';
import { ChatPanel } from '@/components/ChatPanel';

const PALETTE_COLORS = ['#ff4d5e', '#3fa7ff', '#ffb43c', '#37d67a'];

interface LobbyProps {
  room: RoomState;
  myId: string;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

export function Lobby({ room, myId, onToggleReady, onStart, onLeave }: LobbyProps) {
  const me = room.players.find((p) => p.id === myId);
  const isHost = myId === room.hostId;
  const readyCount = room.players.filter((p) => p.ready).length;
  const connected = room.players.filter((p) => p.connected).length;

  return (
    <div className="relative z-10 flex min-h-dvh flex-col items-center px-4 py-8">
      <div className="w-full max-w-3xl">
        {/* header */}
        <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="panel-title">Room code</div>
            <div
              className="font-mono text-4xl font-black tracking-[0.35em] cursor-pointer"
              style={{ color: 'var(--accent-2)', textShadow: '0 0 18px #ffd23c44' }}
              title="Click to copy"
              onClick={() => { try { void navigator.clipboard.writeText(room.code); } catch { /* ignore */ } }}
            >
              {room.code}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--ink-dim)' }}>
              Share this code — friends pick <b>Join</b> on the main menu.
            </div>
          </div>
          <div className="text-sm space-y-1" style={{ color: 'var(--ink-dim)' }}>
            <div>Map: <b style={{ color: 'var(--ink)' }}>{getMap(room.mapId).name}</b></div>
            <div>Target: <b style={{ color: 'var(--ink)' }}>{room.killTarget} kills</b></div>
            <div>Time limit: <b style={{ color: 'var(--ink)' }}>{Math.round(room.timeLimitMs / 60000)} min</b></div>
          </div>
          <button className="btn btn-danger" onClick={onLeave}>Leave</button>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_280px]">
          {/* roster */}
          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="panel-title">Players ({connected}/4)</h2>
              <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>{readyCount}/{room.players.length} ready</span>
            </div>
            <div className="space-y-2">
              {room.players.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    opacity: p.connected ? 1 : 0.45,
                  }}
                >
                  <span
                    className="h-4 w-4 rounded-full shrink-0"
                    style={{ background: PALETTE_COLORS[i % 4], boxShadow: `0 0 10px ${PALETTE_COLORS[i % 4]}66` }}
                  />
                  <span className="font-semibold truncate">{p.name}</span>
                  {p.id === myId && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#ffbe5c22', color: 'var(--accent)' }}>you</span>
                  )}
                  {p.id === room.hostId && (
                    <span title="Host" style={{ color: 'var(--accent-2)' }}>👑</span>
                  )}
                  <span className="ml-auto text-xs font-semibold" style={{ color: p.ready ? 'var(--ok)' : 'var(--ink-dim)' }}>
                    {p.ready ? '✔ ready' : '… not ready'}
                  </span>
                </div>
              ))}
              {Array.from({ length: Math.max(0, 4 - room.players.length) }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm italic"
                  style={{ background: 'var(--bg-2)', border: '1px dashed var(--line)', color: 'var(--ink-dim)' }}
                >
                  <span className="h-4 w-4 rounded-full shrink-0" style={{ border: '1px dashed var(--line)' }} />
                  Open slot — waiting for a challenger…
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                className="btn"
                onClick={onToggleReady}
                style={me?.ready ? { borderColor: 'var(--ok)', color: 'var(--ok)' } : undefined}
              >
                {me?.ready ? '✋ Cancel ready' : '✔ I\'m ready'}
              </button>
              {isHost && (
                <button className="btn btn-primary" onClick={onStart}>🚀 Start match</button>
              )}
              {!isHost && (
                <span className="self-center text-sm" style={{ color: 'var(--ink-dim)' }}>
                  Waiting for the host to start…
                </span>
              )}
            </div>
            {isHost && connected < 2 && (
              <p className="mt-2 text-xs" style={{ color: 'var(--ink-dim)' }}>
                You can start solo to explore the map, or wait for more players.
              </p>
            )}
          </div>

          {/* chat */}
          <div className="panel p-4 flex flex-col min-h-0">
            <h2 className="panel-title mb-2">Lobby chat</h2>
            <ChatPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
