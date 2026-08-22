/** THREAT_MODEL.md "Replay / duplicate": a re-submitted idempotency key whose payload has changed since the first call. */
export class IdempotencyKeyPayloadMismatchError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`idempotency key "${idempotencyKey}" was already used with a different payload`);
    this.name = "IdempotencyKeyPayloadMismatchError";
  }
}

/**
 * Defence in depth (TOOL_CONTRACTS.md: "the adapter repeats resource
 * ownership and version checks for defence in depth"). Should never fire in
 * practice — the gateway's capability check already excludes this — but the
 * adapter does not assume its caller got that right.
 */
export class CapabilityActionTypeMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`adapter expects a capability for "${expected}" but received one for "${actual}"`);
    this.name = "CapabilityActionTypeMismatchError";
  }
}

/**
 * Gate 6 defence-in-depth: independent of the gateway's own status/expiry
 * check, so a capability reaching this adapter through any path OTHER than
 * `executeAction` (a direct, bypassing call to `execute`) is still refused
 * if it is not internally well-formed. This cannot catch a scope mismatch
 * (wrong resource/proposal) — the adapter has no independent source of
 * truth for "the correct" resource/plan to compare against, only the
 * gateway does (see `execution.ts`'s documented residual limitation) — but
 * "not active" and "expired" are checkable from the capability alone.
 */
export class CapabilityNotActiveError extends Error {
  constructor(public readonly reason: "status" | "expired") {
    super(`adapter received a capability that is not currently active (${reason})`);
    this.name = "CapabilityNotActiveError";
  }
}

/** Throws CapabilityNotActiveError if the capability is not currently usable. Call this from every adapter's execute() before doing anything else. */
export function assertCapabilityActive(capability: { readonly status: string; readonly expiresAt: string }, now: Date): void {
  if (capability.status !== "active") {
    throw new CapabilityNotActiveError("status");
  }
  const expiresAtMs = new Date(capability.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new CapabilityNotActiveError("expired");
  }
}
