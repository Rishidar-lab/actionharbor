import type { Capability, CapabilityRejectionReason, CapabilityRequest } from "@actionharbor/contracts";
import { Capability as CapabilitySchema } from "@actionharbor/contracts";

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

  const expiresAtMs = new Date(capability.expiresAt).getTime();
  // Fail closed on an unparseable expiresAt: `NaN <= x` is always false in
  // JS, so without this explicit check a corrupted/malformed expiry would
  // silently skip the expiry rejection entirely instead of being treated as
  // expired — the opposite of fail-closed. (`Capability`'s own zod schema
  // already rejects this shape at the parse boundary; this guards the case
  // where a caller constructs/mutates a `Capability`-typed value without
  // going through that parse, since TypeScript's type does not guarantee
  // runtime validity.)
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
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

export type CapabilityParseAndValidateResult =
  | { readonly ok: true; readonly capability: Capability }
  | { readonly ok: false; readonly reasonCode: CapabilityRejectionReason };

/**
 * `Capability.safeParse` first, `validateCapability` only if that succeeds.
 * The entry point any caller receiving a capability from outside this
 * process's own type-checked construction (an API request body, a
 * deserialized value, anything not fresh off `mintCapability`) should use —
 * `validateCapability` alone trusts its `Capability`-typed parameter is
 * actually well-formed, which TypeScript cannot guarantee at runtime.
 *
 * Returns the PARSED capability object on success, not the caller's raw
 * input — downstream code must operate on what was actually validated, not
 * on an unsafe cast of the pre-parse value.
 */
export function parseAndValidateCapability(
  raw: unknown,
  request: CapabilityRequest,
  now: Date,
): CapabilityParseAndValidateResult {
  const parsed = CapabilitySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reasonCode: "CAPABILITY_MALFORMED" };
  }
  const check = validateCapability(parsed.data, request, now);
  if (!check.ok) {
    return check;
  }
  return { ok: true, capability: parsed.data };
}
