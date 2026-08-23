import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { AuditLedger } from "./audit-ledger.js";
import type { AuditEventInput } from "./hash-chain.js";
import { projectOperation } from "./projection.js";

const NOW = new Date("2026-08-23T10:00:00Z");

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: "POLICY_DECISION",
    actor: { kind: "server", id: "policy-engine-v1" },
    subject: { kind: "action", id: "act_01" },
    payload: {},
    ...overrides,
  };
}

describe("projectOperation", () => {
  it("returns NO_EVENTS and no stages for an operation with no recorded events", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ operationId: "op_other" }));
    const projection = projectOperation(l.list(), "op_missing");
    expect(projection).toEqual({ operationId: "op_missing", stagesSeen: [], finalState: "NO_EVENTS", events: [] });
  });

  it("reconstructs the full happy-path lifecycle from proposal through verification", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ type: "MODEL_PROPOSAL_RECORDED", operationId: "op_1", payload: { goal: "open a ticket" } }));
    l.append(event({ type: "POLICY_DECISION", operationId: "op_1", payload: { outcome: "ALLOW" } }));
    l.append(event({ type: "CAPABILITY_MINTED", operationId: "op_1", payload: {} }));
    l.append(event({ type: "EXECUTION_STARTED", operationId: "op_1", payload: {} }));
    l.append(event({ type: "POSTCONDITION_VERIFIED", operationId: "op_1", payload: {} }));

    const projection = projectOperation(l.list(), "op_1");
    expect(projection.finalState).toBe("VERIFIED");
    expect(projection.stagesSeen).toEqual(["proposal", "policy", "capability", "execution", "verification"]);
    expect(projection.events).toHaveLength(5);
  });

  it("excludes events belonging to a different operation", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ type: "MODEL_PROPOSAL_RECORDED", operationId: "op_A" }));
    l.append(event({ type: "POSTCONDITION_VERIFIED", operationId: "op_B" }));

    const projectionA = projectOperation(l.list(), "op_A");
    expect(projectionA.finalState).toBe("PROPOSED");
    expect(projectionA.events.map((e) => e.type)).toEqual(["MODEL_PROPOSAL_RECORDED"]);
  });

  it("folds by sequence order, not by array/insertion order it is handed", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ type: "MODEL_PROPOSAL_RECORDED", operationId: "op_1" }));
    l.append(event({ type: "EXECUTION_STARTED", operationId: "op_1" }));
    l.append(event({ type: "POSTCONDITION_FAILED", operationId: "op_1" }));

    const reversed = [...l.list()].reverse();
    const projection = projectOperation(reversed, "op_1");
    // Despite being handed newest-first, the fold must still resolve to the
    // TRUE latest state by sequence, not by whichever event came last in the array.
    expect(projection.finalState).toBe("FAILED");
  });

  it("an unknown outcome projects to UNKNOWN_OUTCOME, and a later reconciliation timeout to RECONCILIATION_REQUIRED", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ type: "EXECUTION_STARTED", operationId: "op_1" }));
    l.append(event({ type: "EXECUTION_UNKNOWN", operationId: "op_1" }));
    expect(projectOperation(l.list(), "op_1").finalState).toBe("UNKNOWN_OUTCOME");

    l.append(event({ type: "RECONCILIATION_REQUIRED", operationId: "op_1" }));
    expect(projectOperation(l.list(), "op_1").finalState).toBe("RECONCILIATION_REQUIRED");
  });

  it("AUDIT_INTEGRITY_CHECKED does not itself change the projected final state", () => {
    const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
    l.append(event({ type: "POSTCONDITION_VERIFIED", operationId: "op_1" }));
    l.append(event({ type: "AUDIT_INTEGRITY_CHECKED", operationId: "op_1" }));
    const projection = projectOperation(l.list(), "op_1");
    expect(projection.finalState).toBe("VERIFIED");
    expect(projection.stagesSeen).toEqual(["verification"]);
  });
});
