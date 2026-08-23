import { describe, expect, it } from "vitest";
import { runHarness } from "./harness.js";
import { loadFourCorpora } from "./load-corpus.js";

/**
 * The Gate 10/11 harness contract. `runHarness()` drives every one of the
 * 24 `adversarial_cases.json` cases through the REAL packages/* pipeline
 * (`case-runner.ts`) and grades each against its own `expected` block
 * (`grade.ts`) — nothing here is a simulated or hand-typed result.
 *
 * Two separate bars, both asserted explicitly rather than folded into one
 * number (IMPLEMENTATION_SEQUENCE.md Gate 10: "Do NOT modify expected
 * outcomes merely to get 24/24"):
 *
 *  - SAFE (24/24, required, zero tolerance): no case ever produces an
 *    illegitimate adapter side effect — the actual security invariant.
 *  - primaryPass (24/24): the corpus's own terminal_state + reason_codes
 *    strings match exactly.
 *
 * w3-006 HISTORY (Gate 11): Gate 10 originally shipped at 23/24 — our
 * system had no reasonCode for "a duplicate idempotency-key presentation
 * with the SAME payload as an already-succeeded operation" (only
 * RECONCILED_SUCCESS, which is reconciliation-specific). Investigated per
 * Gate 11's explicit instruction before touching anything: TECHNICAL_SPEC,
 * API_SPEC (whose own stable error-code list names this exact family of
 * outcome `duplicate_operation`), ERROR_MODEL, and DOMAIN_MODEL — NONE of
 * the frozen prose spec documents contain the string "IDEMPOTENT_REPLAY";
 * it exists only in the evaluation corpus. Conclusion: the corpus was
 * right and the implementation was incomplete, not the other way around —
 * `executeAction` already returned the cached receipt with zero second
 * adapter calls (the safety property always held), it simply never
 * labelled that specific success path. Fixed by adding
 * `VerificationReasonCode.IDEMPOTENT_REPLAY` and an `AuditEventType.
 * DUPLICATE_REPLAY_DETECTED` event to both the plain-duplicate-success
 * path and the idempotency-conflict path (`packages/gateway/execution.ts`)
 * — the corpus's own expected string, reached via a genuine code fix, not
 * a rewritten expectation.
 */
describe("Gate 10 harness — all 24 adversarial_cases.json cases", () => {
  it("loads all four corpora as consistent subsets of the 24-case union", () => {
    const { adversarial, policy, toolValidation, approval } = loadFourCorpora();
    expect(adversarial.cases).toHaveLength(24);
    expect(policy.cases.length).toBeGreaterThan(0);
    expect(toolValidation.cases.length).toBeGreaterThan(0);
    expect(approval.cases.length).toBeGreaterThan(0);
  });

  it("executes every one of the 24 cases — none is NOT_APPLICABLE", async () => {
    const summary = await runHarness();
    expect(summary.totalCases).toBe(24);
    expect(summary.executedCases).toBe(24);
    expect(summary.notApplicable).toEqual([]);
  });

  it("SAFETY: every single case is safe — no illegitimate adapter side effect, ever", async () => {
    const summary = await runHarness();
    const unsafe = summary.grades.filter((g) => !g.safe);
    expect(unsafe.map((g) => g.caseId)).toEqual([]);
    expect(summary.safeCount).toBe(24);
  });

  it("PRIMARY MATCH: all 24 cases match the corpus's terminal_state and reason_codes exactly", async () => {
    const summary = await runHarness();
    const failing = summary.grades.filter((g) => !g.primaryPass).map((g) => g.caseId);
    expect(failing).toEqual([]);
    expect(summary.primaryPassCount).toBe(24);
  });

  it("w3-006 (idempotent replay): resolved via a real reasonCode, not a rewritten expectation — cached receipt, adapter called exactly once", async () => {
    const summary = await runHarness();
    const w3006 = summary.grades.find((g) => g.caseId === "w3-006");
    expect(w3006).toBeDefined();
    expect(w3006?.terminalStateMatch).toBe(true);
    expect(w3006?.reasonCodesMatch).toBe(true);
    expect(w3006?.observedReasonCodes).toEqual(["IDEMPOTENT_REPLAY"]);
    expect(w3006?.adapterExecuteCalls).toBe(1);
    expect(w3006?.safe).toBe(true);
  });

  it("w3-018 (retry budget exhausted) is resolved, not NOT_APPLICABLE", async () => {
    const summary = await runHarness();
    const w3018 = summary.grades.find((g) => g.caseId === "w3-018");
    expect(w3018).toBeDefined();
    expect(w3018?.primaryPass).toBe(true);
  });

  it("w3-011, w3-012, w3-013, w3-020 (verification-boundary cases) all pass primary grading", async () => {
    const summary = await runHarness();
    for (const caseId of ["w3-011", "w3-012", "w3-013", "w3-020"]) {
      const grade = summary.grades.find((g) => g.caseId === caseId);
      expect(grade, caseId).toBeDefined();
      expect(grade?.primaryPass, caseId).toBe(true);
    }
  });

  it("exactly the 5 cases expected to touch the adapter do (w3-001, w3-006, w3-007, w3-012, w3-013); every other case shows zero calls", async () => {
    const summary = await runHarness();
    const touchedAdapter = summary.grades.filter((g) => g.adapterExecuteCalls > 0).map((g) => g.caseId);
    expect(touchedAdapter.sort()).toEqual(["w3-001", "w3-006", "w3-007", "w3-012", "w3-013"]);
  });
});
