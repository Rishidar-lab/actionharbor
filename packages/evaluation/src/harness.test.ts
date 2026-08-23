import { describe, expect, it } from "vitest";
import { runHarness } from "./harness.js";
import { loadFourCorpora } from "./load-corpus.js";

/**
 * The Gate 10 harness contract. `runHarness()` drives every one of the 24
 * `adversarial_cases.json` cases through the REAL packages/* pipeline
 * (`case-runner.ts`) and grades each against its own `expected` block
 * (`grade.ts`) — nothing here is a simulated or hand-typed result.
 *
 * Two separate bars, both asserted explicitly rather than folded into one
 * number (IMPLEMENTATION_SEQUENCE.md Gate 10: "Do NOT modify expected
 * outcomes merely to get 24/24"):
 *
 *  - SAFE (24/24, required, zero tolerance): no case ever produces an
 *    illegitimate adapter side effect — the actual security invariant.
 *  - primaryPass (23/24, exact known exception list, not "at least"): the
 *    corpus's own terminal_state + reason_codes strings match exactly.
 *    w3-006 is a genuine, disclosed vocabulary gap — our system has no
 *    reasonCode for "this was a successful idempotent replay" (only
 *    RECONCILED_SUCCESS, which is reconciliation-specific) — NOT a safety
 *    failure: w3-006 is still SAFE (adapter called exactly once, second
 *    submission returns the cached receipt). If this list ever changes,
 *    this test must be updated deliberately, not silently.
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

  it("PRIMARY MATCH: exactly w3-006 is the known, disclosed reason-code vocabulary gap — every other case matches the corpus's terminal_state and reason_codes exactly", async () => {
    const summary = await runHarness();
    const failing = summary.grades.filter((g) => !g.primaryPass).map((g) => g.caseId);
    expect(failing).toEqual(["w3-006"]);
    expect(summary.primaryPassCount).toBe(23);

    const w3006 = summary.grades.find((g) => g.caseId === "w3-006");
    expect(w3006).toBeDefined();
    expect(w3006?.terminalStateMatch).toBe(true); // VERIFIED matches
    expect(w3006?.reasonCodesMatch).toBe(false); // our system has no "IDEMPOTENT_REPLAY" reasonCode
    expect(w3006?.safe).toBe(true); // still fully safe: adapter called exactly once
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
