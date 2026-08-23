import { describe, expect, it } from "vitest";
import { checkRetryBudget } from "./retry-budget.js";

describe("checkRetryBudget", () => {
  it("w3-018 shape: 3 attempts against a budget of 2 is exhausted", () => {
    expect(checkRetryBudget(3, 2)).toEqual({ ok: false, reasonCode: "RETRY_BUDGET_EXHAUSTED" });
  });

  it("exactly at the budget is still ok — the budget is the count of ALLOWED attempts, not a strict-less-than bound", () => {
    expect(checkRetryBudget(2, 2)).toEqual({ ok: true });
  });

  it("under budget is ok", () => {
    expect(checkRetryBudget(1, 2)).toEqual({ ok: true });
  });

  it("TECHNICAL_SPEC.md's '0 retries for non-idempotent writes' means maxAttempts=1 (one attempt, zero retries beyond it) — the first attempt is allowed, a second is not", () => {
    expect(checkRetryBudget(1, 1)).toEqual({ ok: true });
    expect(checkRetryBudget(2, 1)).toEqual({ ok: false, reasonCode: "RETRY_BUDGET_EXHAUSTED" });
  });

  it("far over budget is still just exhausted, not a different outcome", () => {
    expect(checkRetryBudget(100, 2)).toEqual({ ok: false, reasonCode: "RETRY_BUDGET_EXHAUSTED" });
  });
});
