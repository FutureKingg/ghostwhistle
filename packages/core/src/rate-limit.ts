import { policyViolation } from './errors.js';

export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly maxEvents = 3,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  consume(key: string): { remaining: number; resetAt: number } {
    const current = this.now();
    const recent = (this.events.get(key) ?? []).filter((timestamp) => timestamp > current - this.windowMs);
    if (recent.length >= this.maxEvents) {
      const resetAt = recent[0] + this.windowMs;
      throw policyViolation(`Rate limit exceeded. Try again after ${new Date(resetAt).toISOString()}.`);
    }
    recent.push(current);
    this.events.set(key, recent);
    return { remaining: this.maxEvents - recent.length, resetAt: recent[0] + this.windowMs };
  }
}
