import type { Approval, ApprovalRejectionReason, ApprovalRequest } from "@actionharbor/contracts";
import type { RunStateTrigger } from "@actionharbor/contracts";

export type ApprovalCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: ApprovalRejectionReason };

/**
 * The approval validation boundary — same shape and spirit as Gate 0's
 * `validateCapability`, checking status, then expiry, then exact scope.
 * One deliberate difference: a `consumed` approval gets its own reason
 * (`APPROVAL_ALREADY_CONSUMED`) rather than folding into a generic
 * status-invalid code, because it maps to a different outcome downstream
 * (`CONFLICT`, w3-024) than any other status problem does — Gate 0's
 * `Capability` never needed that distinction because nothing in the frozen
 * spec gives "consumed capability" its own terminal state.
 *
 * `PLAN_HASH_MISMATCH` and `APPROVAL_SCOPE_MISMATCH` deliberately do NOT
 * mean "invalidate this approval" here — they mean "this approval does not
 * authorize the request being asked about right now." The STALE state that
 * `04-week3-evaluation/adversarial_cases.json` w3-008 describes ("Plan
 * changed after approval") is reached later, from `AUTHORIZED`, when a
 * capability already minted from a once-valid approval is rechecked against
 * the current plan hash immediately before execution (STATE_MACHINE.md:
 * `AUTHORIZED -> STALE: plan_or_resource_changed`) — that recheck is Gate
 * 6/7's job. This same hash-comparison logic is what it will reuse; Gate 5
 * only owns the question "can this approval grant AUTHORIZED right now."
 */
export function checkApproval(approval: Approval, request: ApprovalRequest, now: Date): ApprovalCheckResult {
  if (approval.status === "consumed") {
    return { ok: false, reasonCode: "APPROVAL_ALREADY_CONSUMED" };
  }

  if (approval.status !== "active") {
    return { ok: false, reasonCode: "APPROVAL_STATUS_INVALID" };
  }

  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reasonCode: "APPROVAL_EXPIRED" };
  }

  if (approval.proposalHash !== request.proposalHash) {
    return { ok: false, reasonCode: "PLAN_HASH_MISMATCH" };
  }

  const scopeMatches = approval.scope.actionType === request.actionType && approval.scope.resourceId === request.resourceId;
  if (!scopeMatches) {
    return { ok: false, reasonCode: "APPROVAL_SCOPE_MISMATCH" };
  }

  return { ok: true };
}

export type ConsumeApprovalResult =
  | { readonly ok: true; readonly approval: Approval }
  | { readonly ok: false; readonly reasonCode: ApprovalRejectionReason };

/**
 * The ONLY way an approval's status becomes `consumed`. Re-runs
 * `checkApproval` first, so consuming an already-consumed approval fails
 * the same way checking it would — single-use enforced at the object level.
 * (Enforcing it under a genuine concurrent race additionally requires an
 * atomic compare-and-swap in whatever persists this object, which is a
 * Gate 6 concern; this function is the invariant that persistence layer has
 * to preserve, not a replacement for it.)
 */
export function consumeApproval(approval: Approval, request: ApprovalRequest, now: Date): ConsumeApprovalResult {
  const check = checkApproval(approval, request, now);
  if (!check.ok) {
    return check;
  }
  return { ok: true, approval: { ...approval, status: "consumed" } };
}

/**
 * Maps a failed `checkApproval` reason to a `RunStateTrigger`, or `null`
 * when the correct response is to leave the run at `APPROVAL_REQUIRED`
 * rather than transition it anywhere (STATE_MACHINE.md has no edge for
 * "wrong approval submitted" — that just means keep waiting for a correct
 * one, or eventually time out). Only `APPROVAL_EXPIRED` and
 * `APPROVAL_ALREADY_CONSUMED` have dedicated outgoing edges from
 * `APPROVAL_REQUIRED` (`ttl_elapsed`, `concurrent_approval_conflict`).
 */
export function selectApprovalTrigger(result: ApprovalCheckResult): RunStateTrigger | null {
  if (result.ok) {
    return "matching_approval";
  }
  switch (result.reasonCode) {
    case "APPROVAL_EXPIRED":
      return "ttl_elapsed";
    case "APPROVAL_ALREADY_CONSUMED":
      return "concurrent_approval_conflict";
    case "APPROVAL_STATUS_INVALID":
    case "PLAN_HASH_MISMATCH":
    case "APPROVAL_SCOPE_MISMATCH":
      return null;
  }
}
