/** Small in-memory limiter for failed login attempts, keyed by client address. */
export class FailureLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  /** Milliseconds until the key may try again, or 0 if it is not blocked. */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.maxFailures ? entry.resetAt - now : 0;
  }

  fail(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
