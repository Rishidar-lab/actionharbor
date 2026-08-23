import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { type AuditEventInput, buildLedgerEntry, computeEntryHash, GENESIS_HASH } from "./hash-chain.js";
import { REDACTED } from "./redact.js";

const NOW = new Date("2026-08-23T10:00:00Z");

function baseInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: "POLICY_DECISION",
    actor: { kind: "server", id: "policy-engine-v1" },
    subject: { kind: "action", id: "act_01" },
    payload: { outcome: "REQUIRE_APPROVAL", reasonCodes: ["HIGH_IMPACT"] },
    ...overrides,
  };
}

describe("buildLedgerEntry", () => {
  it("uses the supplied prevHash and sequence verbatim", () => {
    const entry = buildLedgerEntry(baseInput(), 5, "sha256:some-prior-hash", new CounterIdGenerator(), new FixedClock(NOW));
    expect(entry.sequence).toBe(5);
    expect(entry.prevHash).toBe("sha256:some-prior-hash");
  });

  it("the first entry of a chain uses GENESIS_HASH as prevHash by convention of the caller", () => {
    const entry = buildLedgerEntry(baseInput(), 1, GENESIS_HASH, new CounterIdGenerator(), new FixedClock(NOW));
    expect(entry.prevHash).toBe(GENESIS_HASH);
  });

  it("redacts the payload before it is stored — a secret-shaped field never reaches the ledger row", () => {
    const entry = buildLedgerEntry(
      baseInput({ payload: { outcome: "ALLOW", apiKey: "sk-live-should-not-be-stored" } }),
      1,
      GENESIS_HASH,
      new CounterIdGenerator(),
      new FixedClock(NOW),
    );
    expect(entry.payload["apiKey"]).toBe(REDACTED);
    expect(entry.payload["outcome"]).toBe("ALLOW");
  });

  it("omits optional correlation fields entirely when not supplied (exactOptionalPropertyTypes)", () => {
    const entry = buildLedgerEntry(baseInput(), 1, GENESIS_HASH, new CounterIdGenerator(), new FixedClock(NOW));
    expect("runId" in entry).toBe(false);
    expect("operationId" in entry).toBe(false);
    expect("policyVersion" in entry).toBe(false);
    expect("requestId" in entry).toBe(false);
  });

  it("includes optional correlation fields when supplied", () => {
    const entry = buildLedgerEntry(
      baseInput({ runId: "run_01", operationId: "op_01", policyVersion: "policy-2026-08-22.1", requestId: "req_01" }),
      1,
      GENESIS_HASH,
      new CounterIdGenerator(),
      new FixedClock(NOW),
    );
    expect(entry.runId).toBe("run_01");
    expect(entry.operationId).toBe("op_01");
    expect(entry.policyVersion).toBe("policy-2026-08-22.1");
    expect(entry.requestId).toBe("req_01");
  });

  it("the entry's own hash is exactly computeEntryHash of its own content", () => {
    const entry = buildLedgerEntry(baseInput(), 1, GENESIS_HASH, new CounterIdGenerator(), new FixedClock(NOW));
    const { hash, ...withoutHash } = entry;
    expect(hash).toBe(computeEntryHash(withoutHash));
  });
});

describe("computeEntryHash — determinism and sensitivity", () => {
  function entryWithoutHash(overrides: Record<string, unknown> = {}) {
    return {
      eventId: "evt_000001",
      sequence: 1,
      type: "POLICY_DECISION" as const,
      actor: { kind: "server" as const, id: "policy-engine-v1" },
      subject: { kind: "action" as const, id: "act_01" },
      payload: { outcome: "ALLOW" },
      occurredAt: NOW.toISOString(),
      prevHash: GENESIS_HASH,
      ...overrides,
    };
  }

  it("is deterministic: identical content hashes identically", () => {
    expect(computeEntryHash(entryWithoutHash())).toBe(computeEntryHash(entryWithoutHash()));
  });

  it.each([
    ["prevHash", { prevHash: "sha256:different" }],
    ["sequence", { sequence: 2 }],
    ["payload", { payload: { outcome: "DENY" } }],
    ["type", { type: "CAPABILITY_MINTED" as const }],
    ["subject.id", { subject: { kind: "action" as const, id: "act_02" } }],
    ["actor.id", { actor: { kind: "server" as const, id: "other-engine" } }],
    ["occurredAt", { occurredAt: "2026-08-23T11:00:00Z" }],
  ])("changing %s changes the hash", (_label, overrides) => {
    expect(computeEntryHash(entryWithoutHash(overrides))).not.toBe(computeEntryHash(entryWithoutHash()));
  });
});
