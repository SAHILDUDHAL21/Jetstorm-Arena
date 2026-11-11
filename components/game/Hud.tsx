'use client';

/**
 * In-match HUD rendered over the Phaser canvas: a single one-line top strip
 * (room code, health/jetpack, K/D, ping, scoreboard/chat, weapon chip,
 * leave) plus a top-center kill feed — the screen bottom stays free for the
 * touch controls. Fed by GameBus.
 */
import { useEffect, useState } from 'react';
import type { WeaponId } from '@/shared/types';
import { bus } from '@/game/GameBus';
import { getNet } from '@/lib/client/net';
import { audio } from '@/game/systems/AudioSystem';
import { useBus } from './useBus';
import { MiniMap } from './MiniMap';
import type { BusEvents } from '@/game/GameBus';

const EMPTY_HUD: BusEvents['hud'] = {
  hp: 100, fuel: 1, weapon: 'pistol', weaponName: 'Pistol', mag: 12, reserve: 36,
  alive: true, grenades: 2, respawnInMs: 0, timeLeftMs: 0, kills: 0, deaths: 0,
  reloading: false, reloadMs: 600, reloadRemainingMs: 0, owned: ['pistol'],
};

const WEAPON_LABEL: Record<WeaponId, string> = {
  pistol: 'PST', smg: 'SMG', rifle: 'RFL', shotgun: 'SHG', sniper: 'SNP', rocket: 'RKT',
};

interface FeedLine { id: number; text: string; at: number }

export function Hud({
  code, isTouch, mapId, onLeave,
}: {
  code: string;
  isTouch: boolean;
  mapId?: string;
  onLeave: () => void;
}) {
  const [hud, setHud] = useState<BusEvents['hud']>(EMPTY_HUD);
  const [ping, setPing] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>([]);

  useBus('hud', setHud);
  useBus('net', (n) => setPing(n.ping));
  useBus('feed', (f) => {
    setFeed((prev) => [...prev.slice(-3), { id: f.id, text: f.text, at: Date.now() }]);
  });

  useEffect(() => {
    if (feed.length === 0) return;
    const t = setInterval(() => {
      setFeed((prev) => prev.filter((l) => Date.now() - l.at < 4200));
    }, 500);
    return () => clearInterval(t);
  }, [feed.length]);

  const hpPct = Math.max(0, Math.min(100, hud.hp));
  const fuelPct = Math.max(0, Math.min(1, hud.fuel)) * 100;
  const reloadPct = hud.reloading ? Math.max(0, Math.min(1, 1 - hud.reloadRemainingMs / hud.reloadMs)) : 0;
  const timeLeft = Math.max(0, hud.timeLeftMs);
  const mm = Math.floor(timeLeft / 60000);
  const ss = Math.floor((timeLeft % 60000) / 1000);
  const lowTime = timeLeft > 0 && timeLeft < 30_000;

  const switchTo = (w: WeaponId) => {
    if (w === hud.weapon || !hud.owned.includes(w)) return;
    getNet().switchWeapon(w);
    audio.play('switch', 0.8);
  };

  // Tap/click the weapon chip to cycle owned weapons (touch-friendly).
  const cycleWeapon = () => {
    const owned = hud.owned;
    if (owned.length < 2) return;
    const i = owned.indexOf(hud.weapon);
    switchTo(owned[(i + 1) % owned.length]);
  };

  return (
    <>
      {/* single-line top strip: code · health · K/D · ping · scoreboard · chat · weapon · leave */}
      <div className="absolute left-0 right-0 top-0 z-20 px-2 py-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          {/* room code + match timer */}
          <div className="panel shrink-0 px-2 py-1 flex items-center gap-2 pointer-events-auto">
            <span className="font-mono text-xs font-bold tracking-[0.2em]" style={{ color: 'var(--accent-2)' }}>{code}</span>
            <span className="text-xs tabular-nums font-semibold" style={{ color: lowTime ? 'var(--danger)' : 'var(--ink-dim)' }}>
              {timeLeft > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '--:--'}
            </span>
          </div>

          {/* health + jetpack + grenades */}
          <div className="panel px-2.5 py-1.5 flex items-center gap-2 min-w-0 flex-1 max-w-[240px] pointer-events-auto">
            <span className="text-xs" title="Health">❤️</span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-2)' }}>
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{
                    width: `${hpPct}%`,
                    background: hpPct > 50 ? 'linear-gradient(90deg,#37d67a,#2fb56b)' : hpPct > 25 ? 'linear-gradient(90deg,#ffb43c,#e09a1f)' : 'linear-gradient(90deg,#ff5d5d,#e03c3c)',
                  }}
                />
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" title="Jetpack fuel" style={{ background: 'var(--bg-2)' }}>
                <div
                  className="h-full rounded-full transition-[width] duration-100"
                  style={{ width: `${fuelPct}%`, background: 'linear-gradient(90deg,#ffbe5c,#c98a2e)' }}
                />
              </div>
            </div>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{Math.round(hpPct)}</span>
            <span className="text-[11px] whitespace-nowrap" title="Grenades">💣<span className="font-bold tabular-nums">{hud.grenades}</span></span>
          </div>

          {/* kills / deaths */}
          <div className="panel shrink-0 px-2 py-1 flex items-center gap-1.5 pointer-events-auto">
            <span className="text-[11px] font-bold" style={{ color: 'var(--accent)' }}>K {hud.kills}</span>
            <span className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>·</span>
            <span className="text-[11px] font-bold" style={{ color: 'var(--danger)' }}>D {hud.deaths}</span>
          </div>

          {/* ping (hidden on very narrow screens) */}
          {ping !== null && (
            <div
              className="panel hidden sm:block shrink-0 px-2 py-1 text-[11px] tabular-nums pointer-events-auto"
              style={{ color: ping < 120 ? 'var(--ok)' : ping < 260 ? 'var(--accent-2)' : 'var(--danger)' }}
            >
              {ping} ms
            </div>
          )}

          {/* scoreboard · chat · weapon · leave */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 pointer-events-auto">
            <button className="btn shrink-0 px-2 py-1 text-xs" title="Scoreboard (Tab)" onClick={() => bus.emit('ui', { action: 'scoreboard-toggle' })}>
              🏆
            </button>
            <button className="btn shrink-0 px-2 py-1 text-xs" title="Chat (Enter)" onClick={() => bus.emit('ui', { action: 'chat-open' })}>
              💬
            </button>

            {/* weapon chip: click to cycle owned weapons */}
            <div className="panel px-2 py-1 flex items-center gap-2 pointer-events-auto">
              <button
                onClick={cycleWeapon}
                title={`Switch weapon (${hud.weaponName})`}
                className="rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider"
                style={{
                  border: '1px solid var(--accent)',
                  background: '#ffbe5c22',
                  color: 'var(--accent)',
                  cursor: hud.owned.length > 1 ? 'pointer' : 'default',
                }}
              >
                {WEAPON_LABEL[hud.weapon] ?? hud.weapon.toUpperCase()}
              </button>
              <span className="font-mono tabular-nums leading-none">
                <span className="text-base font-black" style={{ color: hud.mag === 0 ? 'var(--danger)' : 'var(--ink)' }}>{hud.mag}</span>
                <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>/{hud.reserve}</span>
              </span>
              {hud.reloading && (
                <div className="w-9 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${reloadPct * 100}%`, background: 'var(--accent-2)' }} />
                </div>
              )}
            </div>

            <button className="btn btn-danger shrink-0 px-2.5 py-1 text-xs" onClick={onLeave}>Leave</button>
          </div>
        </div>

        {/* minimap: tucked right under the Leave button, with the map name */}
        <div className="absolute right-2 top-full mt-1.5">
          <MiniMap mapId={mapId} />
        </div>
      </div>

      {/* kill feed (top-center, clear of the HUD strip) */}
      <div className="absolute left-1/2 top-14 z-10 -translate-x-1/2 space-y-1 pointer-events-none">
        {feed.map((l) => (
          <div
            key={l.id}
            className="panel px-3 py-1 text-xs font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            {l.text}
          </div>
        ))}
      </div>
    </>
  );
}
