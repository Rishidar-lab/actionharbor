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
