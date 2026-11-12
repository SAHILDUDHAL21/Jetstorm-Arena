/**
 * Short-poll transport for serverless hosting (Vercel).
 * One POST to /api/rt/msg every ~33 ms carries queued uplink messages and
 * returns the session's buffered downlink messages:
 *   { sid, msgs } → { out: ServerMsg[] }
 *
 * No request is ever held open, so the platform keeps serving this session
 * from the same warm instance where its room lives — long-lived SSE streams
 * get the opposite treatment (the router spreads concurrent requests to other
 * instances, and functions get killed at maxDuration).
 */
import type { ClientMsg, ServerMsg } from '../../shared/types';
import type { NetStatus, Transport } from './Transport';

const POLL_FAST_MS = 33; // in a room (lobby or match)
const POLL_SLOW_MS = 400; // menus: presence only
const FAILURE_BACKOFF_MS = 300;
/** Consecutive failures before we conclude this instance lost the session
 * and start over with a fresh sid (the room is reclaimed via hello/join). */
const RESET_AFTER_FAILURES = 40;

function makeSid(): string {
  return `s${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-4)}`;
}

export class HttpTransport implements Transport {
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (status: NetStatus) => void = () => {};
  private sid = makeSid();
  private closed = false;
  private queue: ClientMsg[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private fast = false;
  private lastGood = 0;
  private everOnline = false;
  private inFlight = false;
  private retryAt = 0;
  private failures = 0;

  connect(): void {
    this.closed = false;
    this.onStatus('connecting');
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.interval());
    }
  }

  /** Faster polling while in a room, slow presence polling on menus. */
  setRate(fast: boolean): void {
    if (this.fast === fast) return;
    this.fast = fast;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.tick(), this.interval());
    }
  }

  private interval(): number {
    return this.fast ? POLL_FAST_MS : POLL_SLOW_MS;
  }

  private async tick(): Promise<void> {
    if (this.closed || this.inFlight) return;
    if (Date.now() < this.retryAt) return;
    const msgs = this.queue;
    this.queue = [];
    this.inFlight = true;
    try {
      const res = await fetch('/api/rt/msg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: this.sid, msgs }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { out?: ServerMsg[] };
      this.lastGood = Date.now();
      this.failures = 0;
      if (!this.everOnline) {
        this.everOnline = true;
        this.onStatus('online');
      }
      for (const m of data.out ?? []) this.onMessage(m);
    } catch {
      this.failures++;
      this.retryAt = Date.now() + FAILURE_BACKOFF_MS;
      // requeue control messages (bounded); input frames are ephemeral
      const control = msgs.filter((m) => m.t !== 'input');
      if (control.length && this.queue.length < 10) this.queue.unshift(...control);
      if (Date.now() - this.lastGood > 6000) this.onStatus('offline');
      // The session is gone for good (instance recycled, platform shuffling):
      // a fresh sid re-enters the world; hello/join reclaims the room slot.
      if (this.failures >= RESET_AFTER_FAILURES) {
        this.failures = 0;
        this.sid = makeSid();
        this.everOnline = false;
        this.onStatus('connecting');
      }
    } finally {
      this.inFlight = false;
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Tell the server we left (keepalive so it survives the page unload).
    void fetch('/api/rt/msg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: this.sid, msgs: [{ t: 'leave' }], final: true }),
      keepalive: true,
    }).catch(() => {});
  }

  send(msg: ClientMsg): void {
    if (this.queue.length > 40) return; // flood guard
    this.queue.push(msg);
  }
}
