import type { Approval, Capability, CapabilityMintRejectionReason, CapabilityRequest } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import type { PolicyVerdict } from "@actionharbor/policy";

/** TECHNICAL_SPEC.md operational limit: "capability TTL ≤5 minutes." */
export const MAX_CAPABILITY_TTL_MS = 5 * 60 * 1000;

/**
 * The only two forms of evidence `mintCapability` accepts. There is no
 * third variant, and deliberately no "trust me" escape hatch — this type
 * IS the enforcement of PRODUCT_SPEC.md's "AI intent is not authority to
 * act": nothing shaped like a raw model proposal, a policy `REQUIRE_APPROVAL`
 * verdict on its own, or an unconsumed `Approval` can be passed here at all
 * without failing one of the checks below.
 */
export type AuthorizationEvidence =
  | { readonly kind: "policy-allow"; readonly verdict: PolicyVerdict }
  | { readonly kind: "approved"; readonly approval: Approval };

export type MintCapabilityResult =
  | { readonly ok: true; readonly capability: Capability }
  | { readonly ok: false; readonly reasonCode: CapabilityMintRejectionReason };

/**
 * THE authority-issuing step (ARCHITECTURE.md: "A model may propose
 * `issue_refund`, but it cannot ... mint a capability"). This is the ONLY
 * function in the codebase that constructs a `Capability` with `status:
 * "active"`. Every caller of `execution.ts`'s `executeAction` must present
 * a capability that came from here — enforced not by convention but by
 * `packages/gateway/src/capability-registry.ts`, which only recognizes
 * capabilities this function actually minted.
 *
 * Re-validates its evidence even though the caller (policy/approval layers)
 * already should have — the same "repeat checks for defence in depth"
 * discipline TOOL_CONTRACTS.md applies to adapters, applied here to the one
 * step that matters most.
 */
export function mintCapability(
  evidence: AuthorizationEvidence,
  request: CapabilityRequest,
  idGenerator: IdGenerator,
  clock: Clock,
  ttlMs: number,
): MintCapabilityResult {
  if (evidence.kind === "policy-allow") {
    if (evidence.verdict.outcome !== "ALLOW") {
      return { ok: false, reasonCode: "POLICY_DID_NOT_ALLOW" };
    }
  } else {
    if (evidence.approval.status !== "consumed") {
      // Only `consumeApproval` (Gate 5) produces this status, and only for
      // an approval that itself passed `checkApproval` — an approval that
      // is merely "active" (not yet consumed) is not evidence a capability
      // was actually granted for this specific attempt.
      return { ok: false, reasonCode: "APPROVAL_NOT_CONSUMED" };
    }
    if (evidence.approval.proposalHash !== request.proposalHash) {
      return { ok: false, reasonCode: "PLAN_HASH_MISMATCH" };
    }
    if (evidence.approval.scope.actionType !== request.actionType || evidence.approval.scope.resourceId !== request.resourceId) {
      return { ok: false, reasonCode: "APPROVAL_SCOPE_MISMATCH" };
    }
  }

  const cappedTtlMs = Math.min(ttlMs, MAX_CAPABILITY_TTL_MS);
  const now = clock.now();

  const capability: Capability = {
    id: idGenerator.next("cap"),
    principalId: request.principalId,
    actionType: request.actionType,
    resourceId: request.resourceId,
    proposalHash: request.proposalHash,
    expiresAt: new Date(now.getTime() + cappedTtlMs).toISOString(),
    nonce: idGenerator.next("nonce"),
    status: "active",
  };

  return { ok: true, capability };
}
