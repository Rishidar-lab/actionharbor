import type { RunState } from "@actionharbor/contracts";

export interface StateCopy {
  readonly label: string;
  readonly tone: "neutral" | "info" | "warning" | "success" | "danger";
  readonly whatHappened: string;
  readonly whatCannotHappen: string;
  readonly safeNextAction: string;
}

/**
 * UX_SPEC.md: every required state includes "what happened," "what cannot
 * happen," and "safe next action." One entry per `RunState` (Gate 1) — the
 * exact frozen vocabulary, not a UI-invented status string.
 */
export const STATE_COPY: Record<RunState, StateCopy> = {
  PROPOSED: {
    label: "Proposal received",
    tone: "neutral",
    whatHappened: "The model returned raw, untrusted proposal bytes.",
    whatCannotHappen: "Nothing has been authorized, approved, or executed yet.",
    safeNextAction: "Wait for schema validation.",
  },
  VALIDATED: {
    label: "Proposal validated",
    tone: "neutral",
    whatHappened: "The proposal passed strict schema validation — it is structurally trustworthy, not yet authorized.",
    whatCannotHappen: "No capability exists; the adapter cannot be called.",
    safeNextAction: "Wait for the policy decision.",
  },
  REJECTED: {
    label: "Malformed proposal",
    tone: "danger",
    whatHappened: "The proposal failed strict schema validation and was rejected before reaching policy.",
    whatCannotHappen: "This proposal can never be authorized as submitted.",
    safeNextAction: "A corrected proposal must be submitted as a new run.",
  },
  DENIED: {
    label: "Policy denied",
    tone: "danger",
    whatHappened: "The deterministic policy engine denied this action outright.",
    whatCannotHappen: "No capability was minted; the adapter was never reachable.",
    safeNextAction: "This run is terminal. Inspect the audit timeline for the exact reason codes.",
  },
  APPROVAL_REQUIRED: {
    label: "Approval required",
    tone: "warning",
    whatHappened: "Policy requires a human to approve the exact proposed action before any capability can be minted.",
    whatCannotHappen: "The model cannot approve its own action; no capability exists yet.",
    safeNextAction: "A human approves the exact action shown, or the resource is deliberately drifted to demonstrate staleness.",
  },
  AUTHORIZED: {
    label: "Authorized",
    tone: "info",
    whatHappened: "A capability was minted and is being checked for freshness immediately before use.",
    whatCannotHappen: "Authorization alone is never treated as completed work — AUTHORIZED is never a terminal state.",
    safeNextAction: "Wait for the precondition check and execution attempt.",
  },
  STALE: {
    label: "Stale — blocked",
    tone: "danger",
    whatHappened: "The plan or the resource changed after approval; the precondition check refused to let the capability execute.",
    whatCannotHappen: "This capability cannot execute. No adapter call was made.",
    safeNextAction: "This run is terminal. A fresh proposal and a fresh policy decision are required to try again.",
  },
  EXPIRED: {
    label: "Approval expired",
    tone: "danger",
    whatHappened: "The approval's TTL elapsed before it was used.",
    whatCannotHappen: "This approval can never authorize a capability.",
    safeNextAction: "A new proposal and a new approval are required.",
  },
  EXECUTING: {
    label: "Executing",
    tone: "info",
    whatHappened: "The gateway is invoking the adapter through the one legitimate execution path.",
    whatCannotHappen: "The model has no path to call the adapter directly.",
    safeNextAction: "Wait for the postcondition check.",
  },
  VERIFIED: {
    label: "Verified",
    tone: "success",
    whatHappened: "An independent postcondition check confirmed the adapter's receipt actually satisfies what was required.",
    whatCannotHappen: "Nothing — this is a genuine, evidence-backed success.",
    safeNextAction: "Inspect the audit timeline, or replay to prove idempotency.",
  },
  FAILED: {
    label: "Failed",
    tone: "danger",
    whatHappened: "Either the adapter deterministically failed, or its response did not satisfy the required postcondition.",
    whatCannotHappen: "This attempt cannot be silently treated as a success.",
    safeNextAction: "This run is terminal for this operation.",
  },
  UNKNOWN_OUTCOME: {
    label: "Unknown outcome",
    tone: "warning",
    whatHappened: "The adapter call timed out. The side effect may or may not have already happened — the gateway genuinely does not know.",
    whatCannotHappen: "This can NEVER be silently retried, silently treated as success, or silently treated as failure.",
    safeNextAction: "Reconcile via a read-only lookup — never a blind retry of the write.",
  },
  RECONCILIATION_REQUIRED: {
    label: "Reconciliation required",
    tone: "warning",
    whatHappened: "A reconciliation lookup was attempted and was still inconclusive.",
    whatCannotHappen: "The adapter's write path is not called again.",
    safeNextAction: "Wait, then reconcile again.",
  },
  REVOKED: {
    label: "Revoked",
    tone: "danger",
    whatHappened: "The capability was revoked before it could be used.",
    whatCannotHappen: "This capability can never execute.",
    safeNextAction: "This run is terminal.",
  },
  CONFLICT: {
    label: "Conflict",
    tone: "danger",
    whatHappened: "Two approvals raced for a single-use approval; the second one found it already consumed.",
    whatCannotHappen: "The second approval cannot also authorize a capability.",
    safeNextAction: "This run is terminal.",
  },
};

export const AUDIT_INTEGRITY_FAILED_COPY: StateCopy = {
  label: "Audit integrity failed",
  tone: "danger",
  whatHappened: "Recomputing this run's hash chain from its recorded events did not match — the trail has been tampered with or corrupted.",
  whatCannotHappen: "A failed chain is never silently trusted or repaired automatically.",
  safeNextAction: "Treat this run's history as untrustworthy from the first broken link onward; investigate out-of-band.",
};
