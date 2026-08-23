/**
 * TECHNICAL_SPEC.md operational limit: "maximum retries 2 for safe reads
 * and 0 for non-idempotent writes." Gates 6/7 deliberately never wired a
 * counting/enforcement mechanism for this into `executeAction` — each call
 * to `executeAction` is one deliberate attempt, and `CapabilityRegistry`'s
 * single-use consumption already makes a genuine retry of a non-idempotent
 * write impossible by construction (w3-018 does not test that path; its
 * `input` — `{attempts, max_attempts, error}` — describes a bounded-retry
 * budget for the class of calls the spec allows retrying at all, e.g. safe
 * reads/lookups).
 *
 * This is that budget check as a standalone, pure primitive — the piece an
 * orchestration loop that decides "should I attempt this again" would call
 * before making another attempt. It does not itself retry anything, and it
 * is not wired into `executeAction`'s pipeline: that pipeline is already
 * committed and mutation-tested (Gates 6-8), and retrofitting a retry loop
 * into it now would be exactly the kind of architectural change Gate 10 is
 * told not to make. w3-018 ("Retry budget exhausted") is resolved by this
 * function directly.
 */

export type RetryBudgetResult = { readonly ok: true } | { readonly ok: false; readonly reasonCode: "RETRY_BUDGET_EXHAUSTED" };

export function checkRetryBudget(attempts: number, maxAttempts: number): RetryBudgetResult {
  if (attempts > maxAttempts) {
    return { ok: false, reasonCode: "RETRY_BUDGET_EXHAUSTED" };
  }
  return { ok: true };
}
