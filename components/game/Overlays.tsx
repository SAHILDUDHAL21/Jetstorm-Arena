'use client';

/** Full-screen spinner while the connection and the engine boot. */
import { useEffect, useState } from 'react';
import { useBus } from './useBus';

export function LoadingScreen({ visible, text }: { visible: boolean; text: string }) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center" style={{ background: '#1a120bee' }}>
      <div
        className="h-12 w-12 rounded-full border-4 animate-spin"
        style={{ borderColor: 'var(--line)', borderTopColor: 'var(--accent)' }}
      />
      <div className="mt-4 text-sm font-semibold pulse" style={{ color: 'var(--accent)' }}>{text}</div>
    </div>
  );
}

/** Persistent banner for degraded connectivity. */
export function ConnectionBanner({ status, ping }: { status: string; ping: number | null }) {
  if (status === 'online') return null;
  return (
    <div
      className="absolute left-0 right-0 top-0 z-40 py-1.5 text-center text-sm font-semibold pulse"
      style={{
        background: status === 'offline' ? '#ff5d5d33' : '#ffd23c22',
        borderBottom: `1px solid ${status === 'offline' ? '#ff5d5d66' : '#ffd23c55'}`,
        color: status === 'offline' ? '#ffb3b3' : 'var(--accent-2)',
      }}
    >
      {status === 'offline' ? 'Connection lost — reconnecting…' : 'Connecting…'}
    </div>
  );
}

/** Brief red edge flash when the local player takes damage. */
export function DamageFlash() {
  const [flash, setFlash] = useState(0);

  useBus('damage', (d) => {
    setFlash((f) => Math.min(1, f + Math.min(0.9, d.amount / 60)));
  });

  useEffect(() => {
    if (flash <= 0) return;
    const t = setTimeout(() => setFlash((f) => Math.max(0, f - 0.45)), 70);
    return () => clearTimeout(t);
  }, [flash]);

  if (flash <= 0) return null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-30 pointer-events-none transition-opacity duration-100"
      style={{
        opacity: flash,
        background: 'radial-gradient(ellipse at center, transparent 55%, #ff2a2aaa 100%)',
      }}
    />
  );
}

/** Center-top transient notices ("X reconnected", host migrated…). */
export function NoticeToast() {
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);

  useBus('notice', (n) => {
    setNotice({ id: Date.now(), text: n.text });
  });

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="absolute left-1/2 top-14 z-40 -translate-x-1/2 pointer-events-none">
      <div className="panel px-4 py-2 text-sm" style={{ borderColor: 'var(--accent)' }}>
        {notice.text}
      </div>
    </div>
  );
}

/** 3‑2‑1‑GO overlay synced to the server countdown clock. */
import { getNet } from '@/lib/client/net';

export function CountdownOverlay({
  phase, countdownAtMs,
}: { phase: string; countdownAtMs?: number }) {
  const [view, setView] = useState<number | null>(null);

  useEffect(() => {
    if (!countdownAtMs) {
      setView(null);
      return;
    }
    const now = () => getNet().serverNow();
    const tick = () => {
      const t = now();
      if (phase === 'countdown') {
        const rem = countdownAtMs - t;
        setView(rem > 0 ? Math.ceil(rem / 1000) : 0);
      } else if (phase === 'playing') {
        setView(t - countdownAtMs < 650 ? 0 : null);
      } else {
        setView(null);
      }
    };
    tick();
    const iv = setInterval(tick, 80);
    return () => clearInterval(iv);
  }, [phase, countdownAtMs]);

  if (view === null) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
      <div
        key={view}
        className="pop font-black"
        style={{
          fontSize: view === 0 ? '7rem' : '9rem',
          color: view === 0 ? 'var(--accent-2)' : 'var(--accent)',
          textShadow: '0 0 40px currentColor, 0 4px 0 #0008',
        }}
      >
        {view === 0 ? 'GO!' : view}
      </div>
    </div>
  );
}

/** Shown while the local player is waiting to respawn. */
export function DeathScreen() {
  const [v, setV] = useState({ alive: true, respawnInMs: 0 });

  useBus('hud', (h) => setV({ alive: h.alive, respawnInMs: h.respawnInMs }));

  if (v.alive || v.respawnInMs <= 0) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none" style={{ background: '#400d0d55' }}>
      <div className="text-4xl font-black tracking-widest" style={{ color: '#ffb3b3', textShadow: '0 2px 0 #0008' }}>
        ELIMINATED
      </div>
      <div className="mt-3 text-lg font-bold tabular-nums" style={{ color: 'var(--ink-dim)' }}>
        Respawning in {(v.respawnInMs / 1000).toFixed(1)}s
      </div>
    </div>
  );
}
