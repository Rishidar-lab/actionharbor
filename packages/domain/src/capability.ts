import type { Capability, CapabilityRejectionReason, CapabilityRequest } from "@actionharbor/contracts";

export type CapabilityCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: CapabilityRejectionReason };

/**
 * The capability validation boundary (SECURITY_MODEL.md, ACTION_MODEL.md).
 * Pure and deterministic: given the same capability, request, and instant it
 * always returns the same verdict. This is the ONLY function allowed to
 * decide whether a capability authorizes a call — nothing about "what the
 * model asked for" appears here, only the capability the deterministic
 * policy/approval pipeline already minted.
 *
 * Checked in order so the reason code is always the first thing wrong:
 * status, then expiry, then exact scope match on every field the capability
 * was minted for (principal, action type, resource, proposal hash).
 */
export function validateCapability(
  capability: Capability,
  request: CapabilityRequest,
  now: Date,
): CapabilityCheckResult {
  if (capability.status !== "active") {
    return { ok: false, reasonCode: "CAPABILITY_STATUS_INVALID" };
  }

  if (new Date(capability.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reasonCode: "CAPABILITY_EXPIRED" };
  }

  const scopeMatches =
    capability.principalId === request.principalId &&
    capability.actionType === request.actionType &&
    capability.resourceId === request.resourceId &&
    capability.proposalHash === request.proposalHash;

  if (!scopeMatches) {
    return { ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" };
  }

  return { ok: true };
}
