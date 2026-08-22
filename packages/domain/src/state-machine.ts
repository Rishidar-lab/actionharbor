import type { RunState, RunStateTrigger } from "@actionharbor/contracts";

/**
 * The run state machine (STATE_MACHINE.md). This table — and only this
 * table — defines which transitions exist; `transition()` below is the only
 * function permitted to produce a next state, so "only deterministic code
 * performs transitions" is a structural property, not a convention.
 *
 * Two edges are added beyond the spec's mermaid diagram, each justified at
 * the call site: `capability_revoked` (API_SPEC.md revoke endpoint) and
 * `concurrent_approval_conflict` (adversarial case w3-024).
 */
const TRANSITION_TABLE: Readonly<Record<RunState, Partial<Readonly<Record<RunStateTrigger, RunState>>>>> = {
  PROPOSED: {
    schema_pass: "VALIDATED",
    schema_fail: "REJECTED",
  },
  VALIDATED: {
    policy_deny: "DENIED",
    high_risk: "APPROVAL_REQUIRED",
    low_risk_policy_allow: "AUTHORIZED",
  },
  APPROVAL_REQUIRED: {
    matching_approval: "AUTHORIZED",
    ttl_elapsed: "EXPIRED",
    // Revoking a capability while approval is still pending (API_SPEC.md
    // `POST /api/actions/{id}/revoke`, "revoked state").
    capability_revoked: "REVOKED",
    // Two approvers race a single-use approval (w3-024): the second
    // approval finds the capability already consumed.
    concurrent_approval_conflict: "CONFLICT",
  },
  AUTHORIZED: {
    fresh_preconditions: "EXECUTING",
    plan_or_resource_changed: "STALE",
    // Revoking a capability after authorization but before execution
    // (API_SPEC.md revoke endpoint).
    capability_revoked: "REVOKED",
  },
  EXECUTING: {
    postcondition_pass: "VERIFIED",
    deterministic_tool_failure: "FAILED",
    timeout_transport_ambiguity: "UNKNOWN_OUTCOME",
  },
  UNKNOWN_OUTCOME: {
    lookup_confirms_success: "VERIFIED",
    lookup_confirms_failure: "FAILED",
    lookup_inconclusive: "RECONCILIATION_REQUIRED",
  },
  // Terminal states: STATE_MACHINE.md — "DENIED, EXPIRED, and REVOKED cannot
  // execute"; STALE "requires a new proposal and policy decision" (a new
  // ActionProposal/run, not a transition of this one); VERIFIED, FAILED,
  // RECONCILIATION_REQUIRED, REJECTED, and CONFLICT are end states of the
  // diagram with no further deterministic transition defined.
  REJECTED: {},
  DENIED: {},
  STALE: {},
  EXPIRED: {},
  VERIFIED: {},
  FAILED: {},
  RECONCILIATION_REQUIRED: {},
  REVOKED: {},
  CONFLICT: {},
};

export type TransitionResult =
  | { readonly ok: true; readonly nextState: RunState }
  | { readonly ok: false; readonly reasonCode: "ILLEGAL_TRANSITION" };

/**
 * Apply one trigger to one state. Any (state, trigger) pair not present in
 * `TRANSITION_TABLE` is illegal and rejected — there is no default/fallback
 * transition, so an unrecognized trigger can never silently advance a run.
 */
export function transition(current: RunState, trigger: RunStateTrigger): TransitionResult {
  const nextState = TRANSITION_TABLE[current][trigger];
  if (nextState === undefined) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  return { ok: true, nextState };
}

/** A state with no outgoing transitions in the table. */
export function isTerminal(state: RunState): boolean {
  return Object.keys(TRANSITION_TABLE[state]).length === 0;
}

/** The triggers legally available from a given state, for UI "safe next action" surfaces (UX_SPEC.md). */
export function availableTriggers(state: RunState): readonly RunStateTrigger[] {
  return Object.keys(TRANSITION_TABLE[state]) as RunStateTrigger[];
}
