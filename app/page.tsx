'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { addNetListener, currentRoom, getNet } from '@/lib/client/net';
import {
  getLastRoomCode, getUserName, saveUserName, suggestedName,
} from '@/lib/client/profile';
import { MainMenu } from '@/components/MainMenu';
import { Settings } from '@/components/Settings';
import { HowToPlay } from '@/components/HowToPlay';

// Phaser only runs in the browser — keep it out of the server prerender.
const MenuBackground = dynamic(
  () => import('@/components/MenuBackground').then((m) => m.MenuBackground),
  { ssr: false },
);

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [mapId, setMapId] = useState('random');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastRoom, setLastRoom] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [netStatus, setNetStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const busyRef = useRef(false);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resume an in-flight session (e.g. browser Back after leaving the game).
  useEffect(() => {
    const room = currentRoom();
    if (room) {
      router.replace(room.phase === 'lobby' ? `/lobby?code=${room.code}` : `/game?code=${room.code}`);
      return;
    }
    const saved = getUserName() || suggestedName();
    setName(saved);
    setLastRoom(getLastRoomCode());
  }, [router]);

  // Room/error routing for create/join/quick.
  useEffect(() => {
    const off = addNetListener({
      onRoom: (room) => {
        if (!busyRef.current) return;
        busyRef.current = false;
        router.push(`/lobby?code=${room.code}`);
      },
      onError: (_c, msg) => {
        busyRef.current = false;
        setBusy(false);
        setError(msg);
      },
      onStatus: (s) => {
        setNetStatus(s);
        // A transient offline blip resolves itself via the WS→SSE fallback;
        // if we're still offline a moment later, un-stick the UI. Connection
        // diagnostics go to the browser console, not the page.
        if (s === 'offline' && busyRef.current) {
          if (!offlineTimer.current) {
            offlineTimer.current = setTimeout(() => {
              offlineTimer.current = null;
              if (busyRef.current) {
                busyRef.current = false;
                setBusy(false);
                console.warn(
                  '[Jetstorm] Can’t reach the game server. Start it with `npm run dev` (or `npm run start`) and reload this page — the page must be served by the Node server that hosts the game socket.',
                );
              }
            }, 1500);
          }
        } else if (s === 'online' && offlineTimer.current) {
          clearTimeout(offlineTimer.current);
          offlineTimer.current = null;
        }
      },
    });
    return () => {
      off();
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
    };
  }, [router]);

  const launch = (mode: 'create' | 'quick' | { join: string }) => {
    const finalName = (name.trim() || suggestedName()).slice(0, 16);
    if (finalName.length < 2) {
      setError('Callsign must be at least 2 characters.');
      return;
    }
    saveUserName(finalName);
    setError('');
    setBusy(true);
    busyRef.current = true;
    const net = getNet();
    net.connect();
    net.sendNameJoin(
      mode === 'create' ? { kind: 'create' } : mode === 'quick' ? { kind: 'quick' } : { kind: 'join', code: mode.join },
      finalName,
      undefined,
      mode === 'create' && mapId !== 'random' ? mapId : undefined,
    );
  };

  const rejoin = () => {
    const c = lastRoom;
    if (c) launch({ join: c });
  };

  return (
    <main className="relative">
      <MenuBackground />
      <MainMenu
        name={name}
        setName={setName}
        code={code}
        setCode={setCode}
        mapId={mapId}
        setMapId={setMapId}
        busy={busy}
        error={error}
        lastRoom={lastRoom}
        onCreate={() => launch('create')}
        onJoin={() => launch({ join: code })}
        onQuick={() => launch('quick')}
        onRejoin={rejoin}
        onHelp={() => setShowHelp(true)}
        onSettings={() => setShowSettings(true)}
      />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showHelp && <HowToPlay onClose={() => setShowHelp(false)} />}
    </main>
  );
}
