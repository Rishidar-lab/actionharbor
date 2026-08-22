import { describe, expect, it } from "vitest";
import { CounterIdGenerator, UuidIdGenerator } from "./id.js";

describe("CounterIdGenerator", () => {
  it("produces deterministic, zero-padded, monotonic ids per prefix", () => {
    const gen = new CounterIdGenerator();
    expect(gen.next("cap")).toBe("cap_000001");
    expect(gen.next("cap")).toBe("cap_000002");
  });

  it("keeps separate counters per prefix", () => {
    const gen = new CounterIdGenerator();
    expect(gen.next("cap")).toBe("cap_000001");
    expect(gen.next("op")).toBe("op_000001");
    expect(gen.next("cap")).toBe("cap_000002");
  });

  it("two fresh generators produce identical sequences (reproducible fixtures)", () => {
    const a = new CounterIdGenerator();
    const b = new CounterIdGenerator();
    expect(a.next("evt")).toBe(b.next("evt"));
    expect(a.next("evt")).toBe(b.next("evt"));
  });
});

describe("UuidIdGenerator", () => {
  it("produces prefixed, unique ids", () => {
    const gen = new UuidIdGenerator();
    const a = gen.next("cap");
    const b = gen.next("cap");
    expect(a).toMatch(/^cap_[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});
