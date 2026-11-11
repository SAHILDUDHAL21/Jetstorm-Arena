/**
 * Transport abstraction: client can run over WebSocket (self-hosted custom
 * server) or SSE+POST (Vercel serverless). The game and UI are unaware of
 * which one is active.
 *
 * Auto mode (default) starts on WebSocket and silently falls back to the
 * SSE routes if /ws does not answer — so the game works under `npm run dev`,
 * `npm run dev:web`, `npm run start`, and on hosts where the WS endpoint
 * was not proxied.
 */
import type { ClientMsg, ServerMsg } from '../../shared/types';
import { WsTransport } from './WsTransport';
import { HttpTransport } from './HttpTransport';

export type NetStatus = 'connecting' | 'online' | 'offline';

export interface Transport {
  connect(): void;
  close(): void;
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: NetStatus) => void;
}

/** How long to wait for the WebSocket before switching to SSE. */
const WS_GRACE_MS = 2500;

export function makeTransport(): Transport {
  const forced = process.env.NEXT_PUBLIC_TRANSPORT;
  if (forced === 'http') return new HttpTransport(); // SSE only
  const wsUrl = resolveWsUrl();
  if (wsUrl) return new FallbackTransport(wsUrl);
  return new HttpTransport();
}

/** Legacy helper: resolved WS URL, or null when SSE should be used. */
export function resolveWsUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (process.env.NEXT_PUBLIC_TRANSPORT === 'http') return null;
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host.endsWith('.local')) {
    return `${location.origin.replace(/^http/, 'ws')}/ws`;
  }
  return null; // deployed (e.g. Vercel) → SSE transport
}

/**
 * WebSocket with automatic fallback to the SSE transport. Used when the WS
 * endpoint is plausible but not guaranteed: if the socket cannot open (or
 * takes longer than WS_GRACE_MS), every queued message is replayed over
 * SSE+POST and the connection continues transparently.
 */
export class FallbackTransport implements Transport {
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  private active: Transport;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private fellBack = false;

  constructor(wsUrl: string) {
    const ws = new WsTransport(wsUrl);
    this.active = ws;
    ws.onMessage = (m) => this.onMessage(m);
    ws.onStatus = (s) => this.handleWsStatus(s);
  }

  private handleWsStatus(s: NetStatus): void {
    if (this.fellBack) {
      this.onStatus(s);
      return;
    }
    if (s === 'online') {
      this.clearGrace();
      this.onStatus(s);
      return;
    }
    if (s === 'offline') {
      // WS endpoint refused/unreachable → switch to SSE immediately.
      this.fallback();
      return;
    }
    this.onStatus(s); // 'connecting' passes through
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private fallback(): void {
    if (this.fellBack) return;
    this.fellBack = true;
    this.clearGrace();
    const ws = this.active as WsTransport;
    const queued = ws.drainQueue();
    ws.close();
    const http = new HttpTransport();
    this.active = http;
    http.onMessage = (m) => this.onMessage(m);
    http.onStatus = (s) => this.onStatus(s);
    http.connect();
    for (const m of queued) this.active.send(m);
  }

  connect(): void {
    this.clearGrace();
    this.active.connect();
    if (!this.fellBack) {
      // Some networks swallow the handshake silently — bound the wait.
      this.graceTimer = setTimeout(() => this.fallback(), WS_GRACE_MS);
    }
  }

  close(): void {
    this.clearGrace();
    this.active.close();
  }

  send(msg: ClientMsg): void {
    this.active.send(msg);
  }
}
