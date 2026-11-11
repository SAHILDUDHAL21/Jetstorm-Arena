'use client';

/** Main menu UI: identity, create/join/quick play, help & settings. */
import { Logo } from '@/components/Logo';

export type LaunchMode = 'create' | 'quick' | { join: string };

const MAP_CHOICES = [
  { id: 'random', label: 'Random' },
  { id: 'foundry', label: 'Foundry Yard' },
  { id: 'docks', label: 'Skyline Docks' },
  { id: 'cavern', label: 'Cavern Rift' },
] as const;

interface MainMenuProps {
  name: string;
  setName: (n: string) => void;
  code: string;
  setCode: (c: string) => void;
  mapId: string;
  setMapId: (m: string) => void;
  busy: boolean;
  error: string;
  lastRoom: string | null;
  onCreate: () => void;
  onJoin: () => void;
  onQuick: () => void;
  onRejoin: () => void;
  onHelp: () => void;
  onSettings: () => void;
}

export function MainMenu(p: MainMenuProps) {
  const codeValid = /^[A-Z0-9]{4}$/.test(p.code);
  return (
    <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Logo />

      <p className="mt-3 text-sm" style={{ color: 'var(--ink-dim)' }}>
        2D jetpack duels for up to 4 players · server-authoritative · free to play
      </p>

      <div className="panel mt-8 w-full max-w-md p-6">
        <label className="panel-title block mb-1.5">Callsign</label>
        <input
          className="field"
          value={p.name}
          maxLength={16}
          placeholder="Your name"
          onChange={(e) => p.setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') p.onCreate(); }}
        />

        <div className="mt-5 flex flex-col gap-2.5">
          <div>
            <label className="panel-title block mb-1.5">Map</label>
            <div className="grid grid-cols-2 gap-2">
              {MAP_CHOICES.map((m) => (
                <button
                  key={m.id}
                  className="btn whitespace-nowrap px-3 py-2 text-sm"
                  style={
                    p.mapId === m.id
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'rgba(255,157,60,0.08)' }
                      : undefined
                  }
                  disabled={p.busy}
                  onClick={() => p.setMapId(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" disabled={p.busy} onClick={p.onCreate}>
            ⚡ Create room
          </button>

          <div className="flex gap-2.5">
            <input
              className="field uppercase tracking-[0.4em] font-mono text-center"
              style={{ letterSpacing: '0.4em' }}
              value={p.code}
              maxLength={4}
              inputMode="text"
              autoCapitalize="characters"
              placeholder="CODE"
              onChange={(e) => p.setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && codeValid) p.onJoin(); }}
            />
            <button className="btn btn-lg" disabled={p.busy || !codeValid} onClick={p.onJoin}>
              Join
            </button>
          </div>

          <button className="btn" disabled={p.busy} onClick={p.onQuick}>
            🎯 Quick play
          </button>
        </div>

        {p.error && (
          <div
            className="mt-4 rounded-lg px-3 py-2 text-sm"
            style={{ background: '#ff5d5d22', border: '1px solid #ff5d5d66', color: '#ffb3b3' }}
          >
            {p.error}
          </div>
        )}

        {p.lastRoom && !p.error && (
          <button className="btn mt-4 w-full text-sm" disabled={p.busy} onClick={p.onRejoin}>
            ↩ Rejoin room <b className="font-mono tracking-widest" style={{ color: 'var(--accent-2)' }}>{p.lastRoom}</b>
          </button>
        )}

        {p.busy && (
          <p className="mt-4 text-center text-sm pulse" style={{ color: 'var(--accent)' }}>
            Connecting…
          </p>
        )}
      </div>

      <div className="mt-6 flex gap-2.5">
        <button className="btn px-4" onClick={p.onHelp}>📖 How to play</button>
        <button className="btn px-4" onClick={p.onSettings}>⚙ Settings</button>
      </div>

      <p className="mt-8 text-center text-xs max-w-md" style={{ color: 'var(--ink-dim)' }}>
        An original arena shooter — procedural art, synthesized audio, no third-party assets.
        Desktop: mouse + keyboard. Mobile: twin sticks.
      </p>
    </div>
  );
}
