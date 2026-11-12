'use client';

/**
 * A single NetClient instance shared by every page of the app. Client-side
 * route changes (menu → lobby → game) keep the same connection alive, so a
 * player never drops during the lobby → match handoff. A hard reload just
 * reconnects and the server adopts the slot back via the session token.
 */
import { NetClient, tokenKey } from '@/game/net/NetClient';
import { bus } from '@/game/GameBus';
import { setLastRoomCode } from '@/lib/client/profile';
import type {
  MatchResult, RoomState, ServerMsg, Snapshot,
} from '@/shared/types';

export interface NetListener {
  onWelcome?: (pid: string, token: string, room?: string) => void;
  onRoom?: (room: RoomState) => void;
  onSnap?: (snap: Snapshot) => void;
  onOver?: (results: MatchResult) => void;
  onChat?: (from: string, text: string, sys?: boolean) => void;
  onNotice?: (text: string) => void;
  onError?: (code: string, msg: string) => void;
  onStatus?: (status: 'connecting' | 'online' | 'offline', ping: number | null) => void;
}

const listeners = new Set<NetListener>();

export function addNetListener(l: NetListener): () => void {
  listeners.add(l);
  // Fire any state we already have so late subscribers render instantly.
  if (net) {
    if (net.myId) l.onWelcome?.(net.myId, net.token);
    if (net.room) l.onRoom?.(net.room);
    l.onStatus?.(net.status, net.ping);
  }
  return () => {
    listeners.delete(l);
  };
}

function dispatch(fn: (l: NetListener) => void): void {
  for (const l of [...listeners]) fn(l);
}

let net: NetClient | null = null;

export function getNet(): NetClient {
  if (!net) {
    net = new NetClient({
      onStatus: (status, ping) => {
        bus.emit('net', { status, ping });
        dispatch((l) => l.onStatus?.(status, ping));
      },
      onWelcome: (pid, token, room) => dispatch((l) => l.onWelcome?.(pid, token, room)),
      onRoom: (room) => {
        net!.room = room;
        dispatch((l) => l.onRoom?.(room));
      },
      onSnap: (snap) => dispatch((l) => l.onSnap?.(snap)),
      onOver: (results) => dispatch((l) => l.onOver?.(results)),
      onChat: (from, text, sys) => {
        bus.emit('chat', { from, text, sys });
        dispatch((l) => l.onChat?.(from, text, sys));
      },
      onNotice: (text) => {
        bus.emit('notice', { text });
        dispatch((l) => l.onNotice?.(text));
      },
      onError: (code, msg) => dispatch((l) => l.onError?.(code, msg)),
    });
  }
  return net;
}

/** Connect (idempotent) and, once online, send the hello/identity message. */
export function connectAndHello(name: string, token?: string): void {
  const n = getNet();
  n.connect();
  if (n.status === 'online') {
    n.sendHello(name, token);
    return;
  }
  const off = addNetListener({
    onStatus: (status) => {
      if (status === 'online') {
        off();
        n.sendHello(name, token);
      }
    },
  });
}

/** Look up the reconnect token saved for a room code. */
export function storedToken(code: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Route a raw server message through the listener set (used by tests). */
export function dispatchServerMsg(msg: ServerMsg): void {
  const n = getNet();
  // Reuse NetClient's parsing/routing by feeding the transport callback.
  n.transport.onMessage(msg);
}

/** Leave the current room (if any) and clear local tracking state. */
export function leaveRoom(): void {
  const n = getNet();
  n.leave();
  n.room = null;
  n.latestSnap = null;
  n.transport.setRate?.(false); // back to the menu: slow presence polling
  setLastRoomCode(null);
}

/** True when the singleton still holds a room (stale after leave without update). */
export function currentRoom(): RoomState | null {
  return net?.room ?? null;
}
