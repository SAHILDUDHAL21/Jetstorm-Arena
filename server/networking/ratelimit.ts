/**
 * Token-bucket style per-connection rate limiting for inbound messages.
 * Protects the simulation from flooding (inputs, joins, chat, actions).
 */
const BUCKETS = {
  // high volume: input packets at ~30Hz expected, allow 90/s burst
  input: { capacity: 120, refillPerSec: 75 },
  // everything else: ~10/s expected
  control: { capacity: 20, refillPerSec: 12 },
  chat: { capacity: 6, refillPerSec: 1.2 },
} as const;

type BucketName = keyof typeof BUCKETS;

export class RateLimiter {
  // Buckets start full: a fresh connection may burst up to capacity.
  private tokens: Record<BucketName, number> = {
    input: BUCKETS.input.capacity,
    control: BUCKETS.control.capacity,
    chat: BUCKETS.chat.capacity,
  };
  private last = Date.now();
  private strikes = 0;

  private refill(now: number) {
    const dt = Math.min(5, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (dt <= 0) return;
    for (const k of Object.keys(BUCKETS) as BucketName[]) {
      const cfg = BUCKETS[k];
      this.tokens[k] = Math.min(cfg.capacity, this.tokens[k] + cfg.refillPerSec * dt);
    }
  }

  /** Returns true when the message class is allowed. */
  allow(kind: BucketName, now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens[kind] >= 1) {
      this.tokens[kind] -= 1;
      if (this.strikes > 0) this.strikes--;
      return true;
    }
    this.strikes++;
    return false;
  }

  /** Repeated abuse (3+ strikes) should disconnect the client. */
  abusive(): boolean {
    return this.strikes >= 12;
  }
}
