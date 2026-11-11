'use client';

/**
 * GameClient — orchestrates one match from the React side:
 *   • keeps the shared NetClient connection and routes server messages
 *   • boots/tears down the Phaser game (fresh scene per match/rematch)
 *   • renders HUD, overlays and touch controls around the canvas
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MatchResult, RoomState } from '@/shared/types';
import { createMatchGame, type MatchGameHandle } from '@/game/Game';
import type { MatchScene } from '@/game/scenes/MatchScene';
import { inputState, resetInputState } from '@/game/input/InputState';
import { audio } from '@/game/systems/AudioSystem';
import {
  addNetListener, connectAndHello, getNet, leaveRoom, storedToken,
} from '@/lib/client/net';
import { getUserName, setLastRoomCode } from '@/lib/client/profile';
import { useBus } from './useBus';
import { Hud } from './Hud';
import { Scoreboard } from './Scoreboard';
import { ChatOverlay } from './ChatOverlay';
import { MobileControls } from './MobileControls';
import { MatchEnd } from './MatchEnd';
import {
  ConnectionBanner, CountdownOverlay, DamageFlash, DeathScreen, LoadingScreen, NoticeToast,
} from './Overlays';

export function GameClient({ code }: { code: string }) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MatchGameHandle | null>(null);
  const matchRef = useRef<MatchScene | null>(null);
  const overRef = useRef<MatchResult | null>(null);
  const isTouchRef = useRef(false);

  const [isTouch, setIsTouch] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [phaseView, setPhaseView] = useState<{ phase: string; countdownAtMs?: number }>({ phase: 'connecting' });
  const [over, setOver] = useState<MatchResult | null>(null);
  const [started, setStarted] = useState(false);
  const [matchKey, setMatchKey] = useState(0);
  const [connStatus, setConnStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [ping, setPing] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);

  useBus('net', (n) => {
    setConnStatus(n.status);
    setPing(n.ping);
  });

  // Device class: desktop → keyboard + mouse (even if it has a touchscreen);
  // tablet/phone (touch-first: coarse pointer, no hover) → touch controls.
  // ?touch=1|0 in the URL overrides — handy for testing pads from a desktop.
  useEffect(() => {
    const q = (s: string) => !!window.matchMedia?.(s).matches;
    const fine = q('(pointer: fine)');
    const coarse = q('(pointer: coarse)');
    const hoverHover = q('(hover: hover)');
    const hoverNone = q('(hover: none)');

    let touch: boolean;
    if (typeof window.matchMedia === 'function') {
      if (fine && hoverHover) touch = false; // desktop: mouse/trackpad with hover
      else if (coarse && hoverNone) touch = true; // tablet/phone: touch-first
      else touch = !fine; // unknown: touch only if no mouse-like pointer
    } else {
      touch = 'ontouchstart' in window;
    }

    const override = new URLSearchParams(window.location.search).get('touch');
    if (override === '1') touch = true;
    if (override === '0') touch = false;

    isTouchRef.current = touch;
    setIsTouch(touch);
  }, []);

  // ── Server wiring ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      router.replace('/');
      return;
    }
    const net = getNet();
    const name = getUserName() || 'Player';
    const token = storedToken(code);
    setLastRoomCode(code);

    const off = addNetListener({
      onStatus: setConnStatus,
      onWelcome: (_pid, _tok, welcomeRoom) => {
        // Adopted by token → the room message follows. Otherwise join now.
        if (welcomeRoom || net.room?.code === code) return;
        net.sendNameJoin({ kind: 'join', code }, name, token);
      },
      onRoom: (r) => {
        if (r.code !== code) return;
        setRoom(r);
        setPhaseView({ phase: r.phase, countdownAtMs: r.countdownAt });
        matchRef.current?.onRoomUpdate(r);
        if (r.phase === 'lobby') {
          // match ended and everyone was sent back to the lobby
          router.replace(`/lobby?code=${code}`);
          return;
        }
        if (r.phase === 'over') {
          if (!overRef.current) {
            const res: MatchResult = {
              winner: r.winner,
              reason: 'kills',
              players: r.players.map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths })),
            };
            overRef.current = res;
            setOver(res);
          }
        } else {
          // countdown or playing: a fresh match is (re)starting
          if (overRef.current) {
            overRef.current = null;
            setOver(null);
            setMatchKey((k) => k + 1); // rematch → rebuild the scene clean
          }
          setStarted(true);
          if (r.phase === 'countdown' && r.countdownAt) matchRef.current?.onCountdown(r.countdownAt);
        }
      },
      onSnap: (snap) => matchRef.current?.onSnapshot(snap),
      onOver: (results) => {
        overRef.current = results;
        setOver(results);
      },
    });

    connectAndHello(name, token);
    return () => off();
  }, [code, router]);

  // ── Phaser boot (fresh scene per match) ───────────────────────────────
  useEffect(() => {
    if (!started) return;
    const mount = mountRef.current;
    if (!mount) return;
    const net = getNet();
    const r = net.room;
    if (!r || r.code !== code) return;

    resetInputState();
    inputState.desktop = !isTouchRef.current;
    audio.unlock();

    const handle = createMatchGame(mount, net, net.myId, r.mapId, r);
    handleRef.current = handle;
    let cancelled = false;
    handle.whenMatch.then((m) => {
      if (cancelled) return;
      matchRef.current = m;
      if (net.room) m.onRoomUpdate(net.room);
      if (net.latestSnap) m.onSnapshot(net.latestSnap);
    });

    return () => {
      cancelled = true;
      matchRef.current = null;
      handleRef.current = null;
      handle.destroy();
      inputState.desktop = true;
    };
  }, [started, matchKey, code]);

  // ── Snapshot stall watchdog (e.g. removed from the room silently) ────
  useEffect(() => {
    if (!started) return;
    const iv = setInterval(() => {
      const net = getNet();
      const s = net.latestSnap;
      if (!s || net.room === null) return;
      setStalled(net.serverNow() - s.time > 7000);
    }, 2000);
    return () => clearInterval(iv);
  }, [started]);

  const leave = useCallback(() => {
    leaveRoom();
    router.push('/');
  }, [router]);

  const isHost = room ? room.hostId === getNet().myId : false;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#1a120b' }}>
      <div ref={mountRef} className="game-mount absolute inset-0" />

      <Hud code={code} isTouch={isTouch} mapId={room?.mapId} onLeave={leave} />
      <Scoreboard />
      <ChatOverlay />
      {isTouch && <MobileControls />}

      <CountdownOverlay phase={phaseView.phase} countdownAtMs={phaseView.countdownAtMs} />
      <DeathScreen />
      {over && (
        <MatchEnd result={over} isHost={isHost} onRematch={() => getNet().rematch()} onLeave={leave} />
      )}

      <NoticeToast />
      <DamageFlash />
      <ConnectionBanner status={connStatus} ping={ping} />
      <LoadingScreen visible={!room || !started} text={!room ? 'Entering arena…' : 'Loading arena…'} />

      {stalled && !over && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4" style={{ background: '#1a120be6' }}>
          <div className="text-xl font-bold" style={{ color: 'var(--danger)' }}>Match connection stalled</div>
          <button className="btn btn-primary" onClick={leave}>Back to menu</button>
        </div>
      )}
    </div>
  );
}
