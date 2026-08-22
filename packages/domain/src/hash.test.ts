import { describe, expect, it } from "vitest";
import { canonicalize, computeProposalHash, hashCanonical } from "./hash.js";

describe("canonicalize", () => {
  it("sorts object keys regardless of construction order", () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe('{"a":2,"b":1}');
  });

  it("sorts nested object keys too", () => {
    const value = canonicalize({ z: { y: 1, x: 2 }, a: 1 });
    expect(JSON.stringify(value)).toBe('{"a":1,"z":{"x":2,"y":1}}');
  });

  it("preserves array element order (order is semantically meaningful for arrays)", () => {
    const value = canonicalize([3, 1, 2]);
    expect(JSON.stringify(value)).toBe("[3,1,2]");
  });

  it("rejects NaN", () => {
    expect(() => canonicalize({ amount: Number.NaN })).toThrow(TypeError);
  });

  it("rejects Infinity", () => {
    expect(() => canonicalize({ amount: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it("rejects undefined fields rather than silently dropping them", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(TypeError);
  });

  it("rejects functions", () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow(TypeError);
  });

  it("rejects bigint", () => {
    expect(() => canonicalize({ n: 10n })).toThrow(TypeError);
  });

  it("passes through null, booleans, and strings unchanged", () => {
    expect(canonicalize(null)).toBe(null);
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize("x")).toBe("x");
  });
});

describe("hashCanonical", () => {
  it("is deterministic: same logical value, different key order, same hash", () => {
    const h1 = hashCanonical({ a: 1, b: 2 });
    const h2 = hashCanonical({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it("is prefixed sha256: and is a 64-character hex digest", () => {
    const h = hashCanonical({ a: 1 });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when the value materially changes", () => {
    const h1 = hashCanonical({ amount: 100 });
    const h2 = hashCanonical({ amount: 101 });
    expect(h1).not.toBe(h2);
  });
});

describe("computeProposalHash", () => {
  const base = {
    schemaVersion: "v1",
    actionType: "create_internal_ticket" as const,
    resourceId: "incident-1",
    parameters: { title: "Cold-chain check", priority: "high" },
    evidenceRefs: ["ev-1", "ev-2"],
  };

  it("is stable for the identical plan", () => {
    expect(computeProposalHash(base)).toBe(computeProposalHash(base));
  });

  it("is insensitive to the order evidenceRefs were listed in", () => {
    const reordered = { ...base, evidenceRefs: ["ev-2", "ev-1"] };
    expect(computeProposalHash(base)).toBe(computeProposalHash(reordered));
  });

  it("changes when a parameter changes (e.g. a refund amount) — invalidates prior approval", () => {
    const changed = { ...base, parameters: { ...base.parameters, priority: "low" } };
    expect(computeProposalHash(base)).not.toBe(computeProposalHash(changed));
  });

  it("changes when the resource changes", () => {
    const changed = { ...base, resourceId: "incident-2" };
    expect(computeProposalHash(base)).not.toBe(computeProposalHash(changed));
  });

  it("changes when an evidence reference is added or removed, not just reordered", () => {
    const added = { ...base, evidenceRefs: [...base.evidenceRefs, "ev-3"] };
    expect(computeProposalHash(base)).not.toBe(computeProposalHash(added));
  });

  it("changes when the schema version changes (a versioned action schema, not just the payload)", () => {
    const changed = { ...base, schemaVersion: "v2" };
    expect(computeProposalHash(base)).not.toBe(computeProposalHash(changed));
  });
});
