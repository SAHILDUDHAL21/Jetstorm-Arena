'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { RoomState } from '@/shared/types';
import {
  addNetListener, connectAndHello, currentRoom, getNet, leaveRoom, storedToken,
} from '@/lib/client/net';
import { getUserName, setLastRoomCode } from '@/lib/client/profile';
import { Lobby } from '@/components/Lobby';
import { Logo } from '@/components/Logo';

function LobbyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const code = (params.get('code') ?? '').toUpperCase();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState('');
  const routedRef = useRef(false);

  useEffect(() => {
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      setFatal('That room code doesn\'t look right.');
      return;
    }
    const net = getNet();
    setLastRoomCode(code);
    setRoom(net.room?.code === code ? net.room : null);

    const name = getUserName() || 'Player';
    const token = storedToken(code);
    const off = addNetListener({
      onWelcome: (_pid, _token, welcomeRoom) => {
        // Adopted via token → the room message follows. Otherwise join now.
        if (welcomeRoom || net.room?.code === code || routedRef.current) return;
        net.sendNameJoin({ kind: 'join', code }, name, token);
      },
      onRoom: (r) => {
        if (r.code !== code) return;
        setRoom(r);
        setFatal('');
        if (r.phase !== 'lobby' && !routedRef.current) {
          routedRef.current = true;
          router.replace(`/game?code=${code}`);
        }
      },
      onError: (errCode, msg) => {
        if (['room_not_found', 'room_full', 'match_started', 'bad_code', 'already_in_room'].includes(errCode)) {
          setFatal(msg);
          routedRef.current = true;
        } else {
          setNotice(msg);
        }
      },
      onNotice: setNotice,
    });

    if (!net.room || net.room.code !== code) {
      connectAndHello(name, token);
    }
    return off;
  }, [code, router]);

  // If we're already a member when the page mounts (came from the menu),
  // the singleton's room state is surfaced by addNetListener immediately.
  useEffect(() => {
    const room0 = currentRoom();
    if (room0?.code === code) setRoom(room0);
  }, [code]);

  if (fatal) {
    return (
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4">
        <Logo compact />
        <div className="panel mt-6 max-w-sm p-6 text-center">
          <p className="text-sm mb-4" style={{ color: '#ffb3b3' }}>{fatal}</p>
          <button
            className="btn btn-primary"
            onClick={() => { leaveRoom(); router.push('/'); }}
          >
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-4">
        <div className="text-2xl font-bold pulse" style={{ color: 'var(--accent)' }}>Joining room {code}…</div>
        {notice && <div className="text-sm" style={{ color: 'var(--ink-dim)' }}>{notice}</div>}
      </div>
    );
  }

  return (
    <>
      <Lobby
        room={room}
        myId={getNet().myId}
        onToggleReady={() => getNet().ready(!(room.players.find((p) => p.id === getNet().myId)?.ready ?? false))}
        onStart={() => getNet().start()}
        onLeave={() => { leaveRoom(); router.push('/'); }}
      />
      {notice && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 text-sm panel"
        >
          {notice}
        </div>
      )}
    </>
  );
}

export default function LobbyPage() {
  return (
    <main className="relative">
      <Suspense fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="text-lg pulse" style={{ color: 'var(--accent)' }}>Loading…</div>
        </div>
      }>
        <LobbyInner />
      </Suspense>
    </main>
  );
}
