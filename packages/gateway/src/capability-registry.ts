import type { Capability, CapabilityRejectionReason } from "@actionharbor/contracts";

export type RegistryConsumeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: CapabilityRejectionReason };

/**
 * The stateful half of capability enforcement. `validateCapability`
 * (Gate 0, `packages/domain`) is pure — given ANY object shaped like a
 * `Capability`, it checks internal consistency and exact scope match
 * against a request, but it has no memory, so it cannot tell a genuinely
 * minted capability from a hand-rolled one with identical field values, and
 * it cannot enforce single-use on its own (the same "active"-status object
 * presented twice would validate twice).
 *
 * This registry is what `mintCapability` writes into and what
 * `executeAction` (`execution.ts`) checks membership against BEFORE
 * treating a capability as authoritative. A capability whose `(id, nonce)`
 * pair was never recorded here — however well-formed, however exactly its
 * fields happen to match a legitimate request — is `CAPABILITY_UNKNOWN`.
 * This is the concrete mechanism behind "the model cannot mint a
 * capability by producing matching JSON": producing matching JSON is not
 * enough, because JSON was never written to this registry.
 *
 * `consume` is atomic-in-process (ordinary synchronous JS, no interleaving
 * within one call) and marks the entry consumed as part of the same call
 * that checks it — the single-use guarantee this registry exists for.
 * `consume` is called before the adapter runs, not after it succeeds: a
 * failed execution still burns the capability rather than leaving it
 * re-attemptable (TECHNICAL_SPEC.md: "maximum retries ... 0 for
 * non-idempotent writes" — a fresh authorization cycle is required for any
 * retry, not a replay of the same capability).
 */
export class CapabilityRegistry {
  private readonly byId = new Map<string, Capability>();

  /** Called only by whatever wraps `mintCapability`'s successful result — never by anything reachable from model output. */
  record(capability: Capability): void {
    this.byId.set(capability.id, capability);
  }

  consume(capabilityId: string, nonce: string): RegistryConsumeResult {
    const stored = this.byId.get(capabilityId);
    if (stored === undefined) {
      return { ok: false, reasonCode: "CAPABILITY_UNKNOWN" };
    }
    if (stored.nonce !== nonce) {
      return { ok: false, reasonCode: "CAPABILITY_NONCE_MISMATCH" };
    }
    if (stored.status !== "active") {
      return { ok: false, reasonCode: "CAPABILITY_ALREADY_CONSUMED" };
    }

    this.byId.set(capabilityId, { ...stored, status: "consumed" });
    return { ok: true };
  }

  /** Test/introspection only — not part of the enforcement path. */
  has(capabilityId: string): boolean {
    return this.byId.has(capabilityId);
  }
}
