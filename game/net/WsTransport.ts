/** WebSocket transport: best latency; used for dev + self-hosted servers. */
import type { ClientMsg, ServerMsg } from '../../shared/types';
import type { NetStatus, Transport } from './Transport';

export class WsTransport implements Transport {
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: ClientMsg[] = [];

  constructor(private url: string) {}

  connect(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.closed = false;
    this.onStatus('connecting');
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.onStatus('online');
      for (const m of this.queue) this.send(m);
      this.queue = [];
    };
    this.ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)));
      } catch {
        /* ignore malformed */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (!this.closed) {
        this.onStatus('offline');
        this.scheduleRetry();
      }
    };
    this.ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(): void {
    const delay = Math.min(4000, 500 + this.retry * 500);
    this.retry++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  /** Fallback helper: take (and clear) messages queued while connecting. */
  drainQueue(): ClientMsg[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (msg.t !== 'input') {
      this.queue.push(msg);
      if (this.queue.length > 20) this.queue.shift();
    }
  }
}
