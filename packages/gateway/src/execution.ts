import type { CapabilityRejectionReason, CapabilityRequest, PreconditionRejectionReason } from "@actionharbor/contracts";
import type { Clock } from "@actionharbor/domain";
import { checkPreconditions, hashCanonical, parseAndValidateCapability } from "@actionharbor/domain";
import type { AdapterOperation, AdapterPort } from "./adapter-port.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import { invokeAdapter } from "./gateway.js";
import type { OperationRecord, OperationStore } from "./operation-store.js";

export interface ExecuteActionInput<TParams, TReceipt> {
  /** Untrusted-shaped on purpose — see `parseAndValidateCapability`. Never assume this is already a well-formed `Capability`. */
  readonly capabilityRaw: unknown;
  readonly request: CapabilityRequest;
  readonly registry: CapabilityRegistry;
  readonly operationStore: OperationStore<TReceipt>;
  readonly adapter: AdapterPort<TParams, TReceipt>;
  readonly operation: AdapterOperation;
  readonly params: TParams;
  readonly clock: Clock;
  readonly precondition: {
    readonly currentProposalHash: string;
    readonly currentResourceVersion: number;
    readonly expectedResourceVersion: number;
  };
}

export type ExecuteActionFailure =
  | { readonly ok: false; readonly stage: "capability"; readonly reasonCode: CapabilityRejectionReason }
  | { readonly ok: false; readonly stage: "precondition"; readonly reasonCodes: readonly PreconditionRejectionReason[] }
  | { readonly ok: false; readonly stage: "idempotency"; readonly reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" }
  | { readonly ok: false; readonly stage: "adapter"; readonly errorMessage: string };

export type ExecuteActionResult<TReceipt> =
  | { readonly ok: true; readonly receipt: TReceipt; readonly replay: boolean; readonly operationId: string }
  | ExecuteActionFailure;

/**
 * THE single legitimate path to privileged execution (ARCHITECTURE.md):
 *
 *   capability (schema-parsed + scope/expiry validated against `request`)
 *   -> fresh precondition check (plan / resource version unchanged)
 *   -> idempotency check
 *   -> registry membership + single-use consumption
 *   -> adapter, through Gate 0's invokeAdapter (the only caller of `.execute`)
 *   -> operation record captured
 *
 * Every stage fails closed and returns before the next runs. No path
 * through this function reaches `adapter.execute` except the one at the
 * bottom, and that call only happens after every earlier stage returned ok.
 *
 * Registry consumption is deliberately the LAST check before the adapter,
 * not the first: `parseAndValidateCapability` only inspects the fields of
 * the object the caller presented (which a client's own retained copy
 * still shows as `status: "active"` even after the registry's copy was
 * marked consumed server-side), so it is safe to run before the registry
 * check and does not itself spend the capability. A genuine idempotent
 * replay — same idempotency key, same payload, the client re-presenting
 * the same capability it already used — is served from `OperationStore`
 * BEFORE the registry is ever consulted, so a legitimate retry is never
 * rejected as `CAPABILITY_ALREADY_CONSUMED` just because the original call
 * already succeeded. The capability is only actually spent (registry
 * `consume()`) immediately before a GENUINELY NEW attempt reaches the
 * adapter — including a new attempt that goes on to fail, which still
 * burns it (see the idempotency test suite: a failed execution cannot be
 * retried with the same capability, only with a freshly minted one).
 *
 * RESIDUAL LIMITATION, documented rather than silently assumed away: this
 * function is the enforcement point ONLY for callers that go through it.
 * Nothing in this module stops other application code from importing an
 * `AdapterPort` implementation directly and calling `.execute` on it
 * without ever calling `executeAction` — TypeScript/JS module boundaries do
 * not make a class's public method unreachable to another importer in the
 * same process. What IS true, and is what the direct-adapter-bypass test in
 * `execution.test.ts` proves: (1) nothing reachable from model output can
 * ever produce a `Capability` value at all (proposals and their strict
 * schemas have no capability-shaped field — Gate 3), so a bypassing caller
 * would have to hand-construct one; and (2) even a well-formed,
 * correctly-scoped, hand-constructed `Capability` is rejected by
 * `CapabilityRegistry` as `CAPABILITY_UNKNOWN` the moment it reaches this
 * function, because it was never `record()`ed by `mintCapability`. The gap
 * this does NOT close: a caller who bypasses `executeAction` entirely and
 * invokes an adapter instance's `.execute` directly is not stopped by
 * anything in this module — only by there being no code path from
 * untrusted input to such a call anywhere else in the codebase, which is a
 * property of the whole system's wiring, not of this function alone.
 */
export async function executeAction<TParams, TReceipt>(
  input: ExecuteActionInput<TParams, TReceipt>,
): Promise<ExecuteActionResult<TReceipt>> {
  const now = input.clock.now();

  const capabilityCheck = parseAndValidateCapability(input.capabilityRaw, input.request, now);
  if (!capabilityCheck.ok) {
    return { ok: false, stage: "capability", reasonCode: capabilityCheck.reasonCode };
  }
  const capability = capabilityCheck.capability;

  const preconditionResult = checkPreconditions({
    capability,
    currentProposalHash: input.precondition.currentProposalHash,
    currentResourceVersion: input.precondition.currentResourceVersion,
    expectedResourceVersion: input.precondition.expectedResourceVersion,
  });
  if (!preconditionResult.ok) {
    return { ok: false, stage: "precondition", reasonCodes: preconditionResult.reasonCodes };
  }

  const payloadHash = hashCanonical(input.params);
  const idempotencyLookup = input.operationStore.check(input.operation.idempotencyKey, payloadHash);
  if (idempotencyLookup.status === "conflict") {
    return { ok: false, stage: "idempotency", reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" };
  }
  if (idempotencyLookup.status === "duplicate") {
    const prior = idempotencyLookup.operation;
    if (prior.state === "succeeded" && prior.receipt !== undefined) {
      return { ok: true, receipt: prior.receipt, replay: true, operationId: prior.operationId };
    }
    return { ok: false, stage: "adapter", errorMessage: prior.errorMessage ?? "prior attempt did not succeed" };
  }

  const consumeResult = input.registry.consume(capability.id, capability.nonce);
  if (!consumeResult.ok) {
    return { ok: false, stage: "capability", reasonCode: consumeResult.reasonCode };
  }

  let record: OperationRecord<TReceipt>;
  try {
    const gatewayResult = await invokeAdapter({
      capability,
      request: input.request,
      adapter: input.adapter,
      operation: input.operation,
      params: input.params,
      clock: input.clock,
    });

    if (!gatewayResult.ok) {
      // The gateway's own capability re-check failed. Should be unreachable
      // here since this function already validated the same capability
      // against the same request — kept as a defence-in-depth backstop,
      // not a path this function's own logic is expected to take.
      record = {
        operationId: input.operation.operationId,
        idempotencyKey: input.operation.idempotencyKey,
        capabilityId: capability.id,
        payloadHash,
        state: "failed",
        errorMessage: `gateway rejected: ${gatewayResult.reasonCode}`,
      };
      input.operationStore.record(record);
      return { ok: false, stage: "capability", reasonCode: gatewayResult.reasonCode };
    }

    record = {
      operationId: input.operation.operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId: capability.id,
      payloadHash,
      state: "succeeded",
      receipt: gatewayResult.receipt,
    };
    input.operationStore.record(record);
    return { ok: true, receipt: gatewayResult.receipt, replay: false, operationId: input.operation.operationId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    record = {
      operationId: input.operation.operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId: capability.id,
      payloadHash,
      state: "failed",
      errorMessage,
    };
    input.operationStore.record(record);
    return { ok: false, stage: "adapter", errorMessage };
  }
}
