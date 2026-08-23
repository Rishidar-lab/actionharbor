import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "./hash-chain.js";
import { GENESIS_HASH } from "./hash-chain.js";
import { AuditLedger } from "./audit-ledger.js";

const NOW = new Date("2026-08-23T10:00:00Z");

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: "POLICY_DECISION",
    actor: { kind: "server", id: "policy-engine-v1" },
    subject: { kind: "action", id: "act_01" },
    payload: { outcome: "ALLOW" },
    ...overrides,
  };
}

function ledger(): AuditLedger {
  return new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
}

describe("AuditLedger.append — ordering and chaining", () => {
  it("assigns contiguous sequence numbers starting at 1", () => {
    const l = ledger();
    const e1 = l.append(event());
    const e2 = l.append(event());
    const e3 = l.append(event());
    expect([e1.sequence, e2.sequence, e3.sequence]).toEqual([1, 2, 3]);
  });

  it("the first entry's prevHash is GENESIS_HASH", () => {
    const e1 = ledger().append(event());
    expect(e1.prevHash).toBe(GENESIS_HASH);
  });

  it("each subsequent entry's prevHash is exactly the previous entry's hash", () => {
    const l = ledger();
    const e1 = l.append(event());
    const e2 = l.append(event());
    const e3 = l.append(event());
    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);
  });
});

describe("AuditLedger — append-only surface", () => {
  it("exposes no update/delete/replace/reorder method at all", () => {
    const l = ledger() as unknown as Record<string, unknown>;
    expect(l["update"]).toBeUndefined();
    expect(l["updateEvent"]).toBeUndefined();
    expect(l["delete"]).toBeUndefined();
    expect(l["deleteEvent"]).toBeUndefined();
    expect(l["remove"]).toBeUndefined();
    expect(l["replace"]).toBeUndefined();
    expect(l["reorder"]).toBeUndefined();
    expect(l["clear"]).toBeUndefined();
  });

  it("attempting to call a mutation method that does not exist throws, rather than silently doing nothing", () => {
    const l = ledger() as unknown as { update?: (...args: unknown[]) => unknown };
    expect(() => l.update?.("evt_000001", {})).not.toThrow();
    expect(l.update).toBeUndefined();
  });

  it("list() returns a frozen array — mutating the returned array throws and cannot reach ledger state", () => {
    const l = ledger();
    l.append(event());
    const snapshot = l.list();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => (snapshot as unknown as unknown[]).push({})).toThrow();
    expect(l.list().length).toBe(1);
  });

  it("list() returns an independently-allocated copy each call — an older snapshot does not grow when the ledger does", () => {
    const l = ledger();
    l.append(event());
    const snapshotBefore = l.list();
    l.append(event());
    expect(snapshotBefore.length).toBe(1);
    expect(l.list().length).toBe(2);
  });
});

describe("AuditLedger — correlation lookup", () => {
  it("findByOperation returns only entries for that operation, in append order", () => {
    const l = ledger();
    l.append(event({ operationId: "op_A", type: "EXECUTION_STARTED" }));
    l.append(event({ operationId: "op_B", type: "EXECUTION_STARTED" }));
    l.append(event({ operationId: "op_A", type: "POSTCONDITION_VERIFIED" }));

    const forA = l.findByOperation("op_A");
    expect(forA.map((e) => e.type)).toEqual(["EXECUTION_STARTED", "POSTCONDITION_VERIFIED"]);
  });

  it("findByRun returns only entries for that run", () => {
    const l = ledger();
    l.append(event({ runId: "run_A" }));
    l.append(event({ runId: "run_B" }));
    expect(l.findByRun("run_A")).toHaveLength(1);
  });

  it("an event with no operationId/runId never matches any lookup", () => {
    const l = ledger();
    l.append(event());
    expect(l.findByOperation("op_anything")).toHaveLength(0);
    expect(l.findByRun("run_anything")).toHaveLength(0);
  });
});
