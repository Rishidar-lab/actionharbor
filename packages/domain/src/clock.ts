/**
 * Every place that needs "now" reads it through a `Clock`, never `Date.now()`
 * or `new Date()` directly. This is what lets expiry, TTL, and staleness
 * logic (capability expiry, approval TTL, plan-hash freshness) be tested
 * deterministically instead of racing the real clock.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock fixed to one instant, with time advanceable step by step in tests. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date) {
    this.current = initial;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(next: Date): void {
    this.current = new Date(next.getTime());
  }
}
