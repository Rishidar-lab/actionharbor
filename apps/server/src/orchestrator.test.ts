import { describe, expect, it } from "vitest";
import { approveRun, createRun, OrchestratorError, reconcileRun, replayRun, simulateDrift, verifyRunLedger } from "./orchestrator.js";
import { createAppState } from "./state.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Gate 9 "backend suite": drives the orchestrator directly (no HTTP),
 * against real `@actionharbor/*` packages — the same functions the HTTP
 * layer calls. `http.test.ts` covers the same 5 flows again, but over the
 * actual wire protocol; this file is about the decision logic itself.
 */

describe("A. Blocked action", () => {
  it("denies before any capability exists; the adapter is never touched", async () => {
    const state = createAppState();
    const run = await createRun(state, "blocked");

    expect(run.state).toBe("DENIED");
    expect(run.policyVerdict).toMatchObject({ outcome: "DENY", reasonCodes: ["MISSING_FINANCE_ROLE", "HIGH_IMPACT"] });
    expect(run.capability).toBeUndefined();
    expect((run.adapter as { callCount: number }).callCount).toBe(0);
    expect(run.ledger.list().map((e) => e.type)).toEqual(["MODEL_PROPOSAL_RECORDED", "POLICY_DECISION"]);
  });
});

describe("B. Approval path", () => {
  it("requires approval, mints a capability only after a human approves, executes exactly once, and verifies", async () => {
    const state = createAppState();
    let run = await createRun(state, "approval");
    expect(run.state).toBe("APPROVAL_REQUIRED");
    expect(run.capability).toBeUndefined();

    run = await approveRun(state, run.runId);

    expect(run.state).toBe("VERIFIED");
    expect(run.capability).toBeDefined();
    expect(run.execution).toMatchObject({ ok: true, replay: false });
    expect((run.adapter as { callCount: number }).callCount).toBe(1);
    expect(run.ledger.list().map((e) => e.type)).toEqual([
      "MODEL_PROPOSAL_RECORDED",
      "POLICY_DECISION",
      "APPROVAL_CONSUMED",
      "CAPABILITY_MINTED",
      "EXECUTION_STARTED",
      "POSTCONDITION_VERIFIED",
    ]);
    // Every event on this run's ledger is server- or human-authored — never "model" for anything but the recorded proposal evidence.
    for (const event of run.ledger.list()) {
      if (event.type === "MODEL_PROPOSAL_RECORDED") {
        expect(event.actor.kind).toBe("model");
      } else {
        expect(["server", "human"]).toContain(event.actor.kind);
      }
    }
  });

  it("approve is rejected on a run that is not awaiting approval", async () => {
    const state = createAppState();
    const run = await createRun(state, "blocked");
    await expect(approveRun(state, run.runId)).rejects.toThrow(OrchestratorError);
  });

  it("rejects an unknown scenario id", async () => {
    const state = createAppState();
    await expect(createRun(state, "not-a-real-scenario")).rejects.toThrow(OrchestratorError);
  });

  it("rejects an unknown run id", async () => {
    const state = createAppState();
    await expect(approveRun(state, "run_does_not_exist")).rejects.toThrow(OrchestratorError);
  });
});

describe("C. Replay / duplicate", () => {
  it("a second submission of the identical operation returns the same receipt without a second adapter call", async () => {
    const state = createAppState();
    let run = await createRun(state, "replay");
    run = await approveRun(state, run.runId);
    expect(run.state).toBe("VERIFIED");
    const firstReceipt = run.execution?.receipt;
    expect((run.adapter as { callCount: number }).callCount).toBe(1);

    run = await replayRun(state, run.runId);

    expect(run.state).toBe("VERIFIED");
    expect(run.execution).toMatchObject({ ok: true, replay: true });
    expect(run.execution?.receipt).toEqual(firstReceipt);
    expect((run.adapter as { callCount: number }).callCount).toBe(1);
  });

  it("replay is rejected before a run has ever been verified", async () => {
    const state = createAppState();
    const run = await createRun(state, "replay");
    await expect(replayRun(state, run.runId)).rejects.toThrow(OrchestratorError);
  });
});

describe("D. Stale approval", () => {
  it("a resource-version drift after approval blocks execution with no adapter call", async () => {
    const state = createAppState();
    let run = await createRun(state, "stale");
    expect(run.state).toBe("APPROVAL_REQUIRED");

    run = simulateDrift(state, run.runId);
    expect(run.drifted).toBe(true);
    expect(run.state).toBe("APPROVAL_REQUIRED"); // drift alone does not transition the run

    run = await approveRun(state, run.runId);

    expect(run.state).toBe("STALE");
    expect(run.execution).toMatchObject({ ok: false, stage: "precondition", reasonCodes: expect.arrayContaining(["RESOURCE_VERSION_CHANGED"]) });
    expect((run.adapter as { callCount: number }).callCount).toBe(0);
    // The capability WAS minted (approval was genuinely valid) — it is the pre-execution freshness check that blocks it, exactly STATE_MACHINE.md's AUTHORIZED -> STALE edge.
    expect(run.capability).toBeDefined();
  });

  it("drift can only be simulated while a run is awaiting approval", async () => {
    const state = createAppState();
    let run = await createRun(state, "approval");
    run = await approveRun(state, run.runId);
    expect(run.state).toBe("VERIFIED");
    expect(() => simulateDrift(state, run.runId)).toThrow(OrchestratorError);
  });
});

describe("E. Unknown outcome", () => {
  it("a slow adapter call is reported as UNKNOWN_OUTCOME, never as success or failure", async () => {
    const state = createAppState();
    const run = await createRun(state, "unknown_outcome");

    expect(run.state).toBe("UNKNOWN_OUTCOME");
    expect(run.execution).toMatchObject({ ok: false, stage: "unknown_outcome", reasonCode: "UNKNOWN_OUTCOME" });
    expect(run.ledger.list().map((e) => e.type)).toEqual(["MODEL_PROPOSAL_RECORDED", "POLICY_DECISION", "CAPABILITY_MINTED", "EXECUTION_STARTED", "EXECUTION_UNKNOWN"]);
  });

  it("reconciling before the background call finishes reports RECONCILIATION_REQUIRED, never a blind retry", async () => {
    const state = createAppState();
    const run = await createRun(state, "unknown_outcome");
    expect(run.state).toBe("UNKNOWN_OUTCOME");
    const callCountBefore = (run.adapter as { callCount: number }).callCount;

    const reconciled = await reconcileRun(state, run.runId);

    expect(reconciled.state).toBe("RECONCILIATION_REQUIRED");
    // Reconciliation must go through adapter.lookup only — execute() call count must not increase.
    expect((run.adapter as { callCount: number }).callCount).toBe(callCountBefore);
  });

  it("reconciling after the background call finishes finds the real receipt and verifies it — without a second execute() call", async () => {
    const state = createAppState();
    const run = await createRun(state, "unknown_outcome");
    expect(run.state).toBe("UNKNOWN_OUTCOME");
    const callCountAfterFirstAttempt = (run.adapter as { callCount: number }).callCount;

    await sleep(600); // longer than SlowTicketAdapter's artificial delay

    const reconciled = await reconcileRun(state, run.runId);

    expect(reconciled.state).toBe("VERIFIED");
    expect(reconciled.execution).toMatchObject({ ok: true, replay: true, reasonCode: "RECONCILED_SUCCESS" });
    expect((run.adapter as { callCount: number }).callCount).toBe(callCountAfterFirstAttempt);
    expect(run.ledger.list().map((e) => e.type)).toEqual([
      "MODEL_PROPOSAL_RECORDED",
      "POLICY_DECISION",
      "CAPABILITY_MINTED",
      "EXECUTION_STARTED",
      "EXECUTION_UNKNOWN",
      "POSTCONDITION_VERIFIED",
    ]);
  });

  it("reconcile is rejected on a run that never went UNKNOWN_OUTCOME", async () => {
    const state = createAppState();
    let run = await createRun(state, "approval");
    run = await approveRun(state, run.runId);
    expect(run.state).toBe("VERIFIED");
    await expect(reconcileRun(state, run.runId)).rejects.toThrow(OrchestratorError);
  });
});

describe("Ledger integrity self-check", () => {
  it("a genuine, untouched run always verifies", async () => {
    const state = createAppState();
    let run = await createRun(state, "approval");
    run = await approveRun(state, run.runId);

    const result = verifyRunLedger(state, run.runId);
    expect(result.ok).toBe(true);

    // The check itself is recorded as a server-authored event — appended AFTER the check, so it is not part of what was checked.
    const types = run.ledger.list().map((e) => e.type);
    expect(types.at(-1)).toBe("AUDIT_INTEGRITY_CHECKED");
    expect(run.ledger.list().at(-1)?.actor.kind).toBe("server");
  });

  it("throws on an unknown run id", () => {
    const state = createAppState();
    expect(() => verifyRunLedger(state, "run_does_not_exist")).toThrow(OrchestratorError);
  });
});
