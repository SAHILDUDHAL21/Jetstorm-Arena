/**
 * SSE + POST transport for serverless hosting (Vercel).
 *   downlink: EventSource → /api/rt/stream (auto-reconnects)
 *   uplink:   batched POST → /api/rt/msg every ~33ms
 */
import type { ClientMsg, ServerMsg } from '../../shared/types';
import type { NetStatus, Transport } from './Transport';

function makeSid(): string {
  return `s${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-4)}`;
}

export class HttpTransport implements Transport {
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  private sid = makeSid();
  private es: EventSource | null = null;
  private closed = false;
  private queue: ClientMsg[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastGood = 0;

  connect(): void {
    this.closed = false;
    this.onStatus('connecting');
    this.openStream();
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => void this.flush(), 33);
    }
  }

  private openStream(): void {
    if (this.es) this.es.close();
    const es = new EventSource(`/api/rt/stream?sid=${encodeURIComponent(this.sid)}`);
    this.es = es;
    es.onopen = () => {
      this.onStatus('online');
    };
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMsg;
        this.lastGood = Date.now();
        this.onMessage(msg);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      if (!this.closed) {
        if (Date.now() - this.lastGood > 6000) this.onStatus('offline');
        else if (es.readyState === EventSource.CLOSED) {
          // server restarted or stream cut: open a fresh one
          setTimeout(() => {
            if (!this.closed) this.openStream();
          }, 800);
        }
      }
    };
  }

  private async flush(): Promise<void> {
    if (this.closed || this.queue.length === 0) return;
    const msgs = this.queue;
    this.queue = [];
    try {
      const res = await fetch('/api/rt/msg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: this.sid, msgs }),
        keepalive: false,
      });
      if (!res.ok && msgs.some((m) => m.t !== 'input')) {
        // requeue control messages on failure (bounded)
        const control = msgs.filter((m) => m.t !== 'input');
        if (control.length && this.queue.length < 10) this.queue.unshift(...control);
      }
    } catch {
      if (msgs.some((m) => m.t !== 'input') && this.queue.length < 10) {
        this.queue.unshift(...msgs.filter((m) => m.t !== 'input'));
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.es?.close();
    this.es = null;
    void fetch('/api/rt/msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: this.sid, msgs: [{ t: 'leave' }] }),
      keepalive: true,
    }).catch(() => {});
  }

  send(msg: ClientMsg): void {
    if (this.queue.length > 40) return; // flood guard
    this.queue.push(msg);
  }
}
