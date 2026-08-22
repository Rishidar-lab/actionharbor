import { describe, expect, it } from "vitest";
import { FixedClock, SystemClock } from "./clock.js";

describe("SystemClock", () => {
  it("returns a Date close to real now", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("FixedClock", () => {
  it("returns the same instant until advanced", () => {
    const clock = new FixedClock(new Date("2026-08-22T09:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-08-22T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-22T09:00:00.000Z");
  });

  it("advances by exactly the given milliseconds", () => {
    const clock = new FixedClock(new Date("2026-08-22T09:00:00Z"));
    clock.advanceMs(60_000);
    expect(clock.now().toISOString()).toBe("2026-08-22T09:01:00.000Z");
  });

  it("set() jumps to an arbitrary instant", () => {
    const clock = new FixedClock(new Date("2026-08-22T09:00:00Z"));
    clock.set(new Date("2030-01-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("returned Date is a defensive copy, not internal state", () => {
    const clock = new FixedClock(new Date("2026-08-22T09:00:00Z"));
    const snapshot = clock.now();
    snapshot.setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-08-22T09:00:00.000Z");
  });
});
