import { randomUUID } from "node:crypto";

/**
 * Every place that mints an identifier reads it through an `IdGenerator`,
 * never `crypto.randomUUID()` directly. Tests that need to assert on exact
 * ids (fixtures, audit sequence, idempotency-key collision cases) can then
 * supply a `CounterIdGenerator` instead of asserting against random output.
 */
export interface IdGenerator {
  next(prefix: string): string;
}

export class UuidIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

/** Deterministic, monotonic ids for tests: `next("cap")` -> `cap_000001`, `cap_000002`, ... */
export class CounterIdGenerator implements IdGenerator {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const count = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, count);
    return `${prefix}_${String(count).padStart(6, "0")}`;
  }
}
