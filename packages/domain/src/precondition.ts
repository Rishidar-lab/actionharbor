import type { Capability, PreconditionRejectionReason } from "@actionharbor/contracts";

export interface PreconditionCheckInput {
  readonly capability: Capability;
  /** The proposal hash recomputed fresh from CURRENT state, right before execution — not the hash the capability was minted with. */
  readonly currentProposalHash: string;
  readonly currentResourceVersion: number;
  /** The resource version that was current when the capability was minted (what execution is entitled to assume is still true). */
  readonly expectedResourceVersion: number;
}

export type PreconditionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCodes: readonly PreconditionRejectionReason[] };

/**
 * The pre-execution freshness recheck (STATE_MACHINE.md: `AUTHORIZED ->
 * STALE: plan_or_resource_changed`; ACTION_MODEL.md: "current resource
 * version ... all match"). Runs immediately before the adapter is called,
 * using state that is current AT THAT MOMENT — not what was true when the
 * capability was minted. THREAT_MODEL.md "Stale approval / TOCTOU": a
 * resource changing between approval and execution must block execution,
 * not race it.
 *
 * Two independently-shaped rejections, each pinned by one evaluation case
 * (not stylistic — see the reason enum's doc comment in
 * `@actionharbor/contracts`): a changed plan (w3-008) reports
 * `[PLAN_HASH_MISMATCH]` alone; a changed resource version (w3-010) reports
 * `[PRECONDITION_FAILED, RESOURCE_VERSION_CHANGED]` together. Plan hash is
 * checked first — if the plan itself changed, the resource-version number
 * pinned to the old plan is no longer a meaningful thing to compare.
 */
export function checkPreconditions(input: PreconditionCheckInput): PreconditionCheckResult {
  if (input.capability.proposalHash !== input.currentProposalHash) {
    return { ok: false, reasonCodes: ["PLAN_HASH_MISMATCH"] };
  }

  if (input.currentResourceVersion !== input.expectedResourceVersion) {
    return { ok: false, reasonCodes: ["PRECONDITION_FAILED", "RESOURCE_VERSION_CHANGED"] };
  }

  return { ok: true };
}
