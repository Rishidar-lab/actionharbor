import type { ActionType, Capability } from "@actionharbor/contracts";

/**
 * Identifies one execution attempt. `operationId` is the durable handle used
 * to look up an ambiguous outcome later (TECHNICAL_SPEC.md `operations`
 * table); `idempotencyKey` is what the adapter uses to refuse a duplicate
 * write with a different payload. Both are assigned by the gateway, never by
 * the model or the adapter.
 */
export interface AdapterOperation {
  readonly operationId: string;
  readonly idempotencyKey: string;
}

export type AdapterLookupResult<TReceipt> = { readonly status: "unknown" } | { readonly status: "found"; readonly receipt: TReceipt };

/**
 * The adapter boundary (TOOL_CONTRACTS.md): "Every adapter exposes a typed
 * `execute(operation, capability, params)` and `lookup(operationId)`."
 *
 * An adapter receives a server-created `Capability`, never a model token, and
 * is expected to repeat resource ownership/version checks itself for defence
 * in depth — but the gateway is what decides whether `execute` is called at
 * all. `TParams` is the adapter's own strict, allowlisted parameter shape;
 * `TReceipt` is what it hands back as evidence of the side effect.
 */
export interface AdapterPort<TParams, TReceipt> {
  readonly actionType: ActionType;
  execute(operation: AdapterOperation, capability: Capability, params: TParams): Promise<TReceipt>;
  lookup(operationId: string): Promise<AdapterLookupResult<TReceipt>>;
}
