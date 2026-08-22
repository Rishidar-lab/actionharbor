import type { OperationState } from "@actionharbor/contracts";

export interface OperationRecord<TReceipt> {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly capabilityId: string;
  readonly payloadHash: string;
  readonly state: OperationState;
  readonly receipt?: TReceipt;
  readonly errorMessage?: string;
}

export type OperationLookup<TReceipt> =
  | { readonly status: "new" }
  | { readonly status: "duplicate"; readonly operation: OperationRecord<TReceipt> }
  | { readonly status: "conflict" };

/**
 * `Operation {id, capabilityId, idempotencyKey, state, adapterReceipt, ...}`
 * (DOMAIN_MODEL.md). This is the gateway's OWN idempotency bookkeeping —
 * distinct from (and in addition to) each fake adapter's internal
 * idempotency map from Gate 4. A real external tool would not remember
 * anything about a prior call the way the in-process fakes happen to; the
 * caller has to track it. This class is what a real gateway would need
 * regardless of what the adapter itself does or does not remember.
 *
 * `check()` is consulted BEFORE the adapter is ever called: a `"duplicate"`
 * result means "do not call the adapter again, here is the prior receipt";
 * a `"conflict"` result means "do not call the adapter at all, this replays
 * an idempotency key with a different payload." Only `"new"` proceeds to
 * `invokeAdapter`.
 */
export class OperationStore<TReceipt> {
  private readonly byIdempotencyKey = new Map<string, OperationRecord<TReceipt>>();
  private readonly byOperationId = new Map<string, OperationRecord<TReceipt>>();

  check(idempotencyKey: string, payloadHash: string): OperationLookup<TReceipt> {
    const existing = this.byIdempotencyKey.get(idempotencyKey);
    if (existing === undefined) {
      return { status: "new" };
    }
    if (existing.payloadHash !== payloadHash) {
      return { status: "conflict" };
    }
    return { status: "duplicate", operation: existing };
  }

  record(operation: OperationRecord<TReceipt>): void {
    this.byIdempotencyKey.set(operation.idempotencyKey, operation);
    this.byOperationId.set(operation.operationId, operation);
  }

  lookup(operationId: string): OperationRecord<TReceipt> | undefined {
    return this.byOperationId.get(operationId);
  }
}
