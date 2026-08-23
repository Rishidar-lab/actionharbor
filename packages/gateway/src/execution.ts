import type { AuditEventType, AuditLedgerEntry, CapabilityRejectionReason, CapabilityRequest, PreconditionRejectionReason } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { checkPreconditions, hashCanonical, parseAndValidateCapability } from "@actionharbor/domain";
import type { AuditLedger } from "@actionharbor/ledger";
import { verifyPostcondition, type PostconditionExpectation } from "@actionharbor/verifier";
import type { AdapterOperation, AdapterPort } from "./adapter-port.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import { invokeAdapter } from "./gateway.js";
import type { OperationRecord, OperationStore } from "./operation-store.js";

/** Every audit event this gateway emits is attributed to this fixed server identity — never to the model, never to a caller-supplied value. */
const EXECUTION_GATEWAY_ACTOR = { kind: "server", id: "execution-gateway-v1" } as const;

/** TECHNICAL_SPEC.md operational limit: "per-run execution budget 30 seconds; every timeout becomes UNKNOWN_OUTCOME pending lookup." */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;

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
  readonly idGenerator: IdGenerator;
  /** The append-only, hash-chained audit store (Gate 8). Every event this function emits is appended here, never merely returned. */
  readonly ledger: AuditLedger;
  readonly precondition: {
    readonly currentProposalHash: string;
    readonly currentResourceVersion: number;
    readonly expectedResourceVersion: number;
  };
  /** What a genuine postcondition pass looks like for this exact call (Gate 7). */
  readonly postcondition: PostconditionExpectation;
  readonly timeoutMs?: number;
}

export type ExecuteActionFailure =
  | { readonly ok: false; readonly stage: "capability"; readonly reasonCode: CapabilityRejectionReason; readonly auditEvents: readonly AuditLedgerEntry[] }
  | { readonly ok: false; readonly stage: "precondition"; readonly reasonCodes: readonly PreconditionRejectionReason[]; readonly auditEvents: readonly AuditLedgerEntry[] }
  | { readonly ok: false; readonly stage: "idempotency"; readonly reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"; readonly auditEvents: readonly AuditLedgerEntry[] }
  | { readonly ok: false; readonly stage: "postcondition"; readonly reasonCode: "POSTCONDITION_UNVERIFIED"; readonly auditEvents: readonly AuditLedgerEntry[] }
  | { readonly ok: false; readonly stage: "unknown_outcome"; readonly operationId: string; readonly reasonCode: "UNKNOWN_OUTCOME"; readonly auditEvents: readonly AuditLedgerEntry[] }
  /** STATE_MACHINE.md `UNKNOWN_OUTCOME -> RECONCILIATION_REQUIRED: lookup_inconclusive` — distinct from the initial `unknown_outcome` stage: this means a reconciliation lookup was actually attempted and still could not resolve it (w3-012), not merely "we haven't looked yet." */
  | { readonly ok: false; readonly stage: "reconciliation_required"; readonly operationId: string; readonly reasonCode: "UNKNOWN_OUTCOME"; readonly auditEvents: readonly AuditLedgerEntry[] }
  | { readonly ok: false; readonly stage: "adapter"; readonly errorMessage: string; readonly auditEvents: readonly AuditLedgerEntry[] };

export type ExecuteActionSuccess<TReceipt> = {
  readonly ok: true;
  readonly receipt: TReceipt;
  readonly replay: boolean;
  readonly operationId: string;
  readonly auditEvents: readonly AuditLedgerEntry[];
  /**
   * `"RECONCILED_SUCCESS"` when this success was resolved via a
   * reconciliation lookup rather than the original synchronous call
   * (w3-013). `"IDEMPOTENT_REPLAY"` when this is a duplicate idempotency-key
   * presentation with the same payload as an already-`succeeded` operation
   * (w3-006) — the cached receipt is returned, `adapter.execute` is never
   * called a second time. Absent only for a genuinely fresh, first-time
   * success.
   */
  readonly reasonCode?: "RECONCILED_SUCCESS" | "IDEMPOTENT_REPLAY";
};

export type ExecuteActionResult<TReceipt> = ExecuteActionSuccess<TReceipt> | ExecuteActionFailure;

type RaceOutcome<T> = { readonly kind: "resolved"; readonly value: T } | { readonly kind: "rejected"; readonly error: unknown } | { readonly kind: "timeout" };

/**
 * Races `promise` against `timeoutMs`. If the timeout wins, `promise` is
 * left running — this function does not (cannot, in plain JS) cancel it —
 * and a LATE resolution or rejection is deliberately dropped rather than
 * reported: the caller has already committed to `UNKNOWN_OUTCOME`, and a
 * signal arriving after that decision is exactly what "the side effect may
 * have happened, we don't know" means. This is what makes the timeout path
 * safe to test deterministically with `vi.useFakeTimers()` without needing
 * real wall-clock delay.
 */
function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<RaceOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ kind: "timeout" });
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "resolved", value });
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "rejected", error });
        }
      },
    );
  });
}

/**
 * THE single legitimate path to privileged execution AND the boundary
 * between "execution attempted" and "execution proven successful"
 * (ARCHITECTURE.md; STATE_MACHINE.md `EXECUTING -> {VERIFIED, FAILED,
 * UNKNOWN_OUTCOME}` and `UNKNOWN_OUTCOME -> {VERIFIED, FAILED,
 * RECONCILIATION_REQUIRED}`):
 *
 *   capability (schema-parsed + scope/expiry validated against `request`)
 *   -> fresh precondition check (plan / resource version unchanged)
 *   -> idempotency check
 *     - "new": registry consume -> adapter call raced against a timeout
 *       -> independent postcondition verification -> SUCCEEDED / FAILED
 *     - "duplicate", prior state SUCCEEDED/FAILED: return the recorded
 *       outcome, never call the adapter again
 *     - "duplicate", prior state UNKNOWN_OUTCOME: reconcile via
 *       `adapter.lookup` — NEVER `adapter.execute` — then verify whatever
 *       is found the same way a fresh call would
 *     - "conflict": rejected before the adapter is ever called
 *
 * The core invariant: NO path in this function reaches `ok: true` without
 * `verifyPostcondition` having actually run and passed on a receipt that
 * came from `adapter.execute` or `adapter.lookup` — never from the
 * caller's narration, never from a transport-success signal alone
 * (`invokeAdapter` resolving is not itself treated as success), never from
 * anything the model could have influenced (the model has no reachable
 * path to either function — Gate 3/6's boundaries).
 */
export async function executeAction<TParams, TReceipt>(
  input: ExecuteActionInput<TParams, TReceipt>,
): Promise<ExecuteActionResult<TReceipt>> {
  const now = input.clock.now();
  const operationId = input.operation.operationId;
  const audit = (type: AuditEventType, payload: Record<string, unknown>): AuditLedgerEntry =>
    input.ledger.append({ type, actor: EXECUTION_GATEWAY_ACTOR, subject: { kind: "operation", id: operationId }, payload, operationId });

  const capabilityCheck = parseAndValidateCapability(input.capabilityRaw, input.request, now);
  if (!capabilityCheck.ok) {
    return { ok: false, stage: "capability", reasonCode: capabilityCheck.reasonCode, auditEvents: [] };
  }
  const capability = capabilityCheck.capability;

  const preconditionResult = checkPreconditions({
    capability,
    currentProposalHash: input.precondition.currentProposalHash,
    currentResourceVersion: input.precondition.currentResourceVersion,
    expectedResourceVersion: input.precondition.expectedResourceVersion,
  });
  if (!preconditionResult.ok) {
    const auditEvents = [audit("PRECONDITION_FAILED", { reasonCodes: preconditionResult.reasonCodes })];
    return { ok: false, stage: "precondition", reasonCodes: preconditionResult.reasonCodes, auditEvents };
  }

  const payloadHash = hashCanonical(input.params);
  const idempotencyLookup = input.operationStore.check(input.operation.idempotencyKey, payloadHash);

  if (idempotencyLookup.status === "conflict") {
    const auditEvents = [audit("DUPLICATE_REPLAY_DETECTED", { reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" })];
    return { ok: false, stage: "idempotency", reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", auditEvents };
  }

  if (idempotencyLookup.status === "duplicate") {
    return reconcileDuplicate(input, idempotencyLookup.operation, audit);
  }

  // "new": a genuinely fresh attempt. Only this path may consume the
  // capability and call the adapter.
  const consumeResult = input.registry.consume(capability.id, capability.nonce);
  if (!consumeResult.ok) {
    return { ok: false, stage: "capability", reasonCode: consumeResult.reasonCode, auditEvents: [] };
  }

  const auditEvents: AuditLedgerEntry[] = [audit("EXECUTION_STARTED", { actionType: input.request.actionType })];
  const timeoutMs = input.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;

  const raceResult = await raceWithTimeout(
    invokeAdapter({
      capability,
      request: input.request,
      adapter: input.adapter,
      operation: input.operation,
      params: input.params,
      clock: input.clock,
    }),
    timeoutMs,
  );

  if (raceResult.kind === "timeout") {
    const record: OperationRecord<TReceipt> = {
      operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId: capability.id,
      payloadHash,
      state: "unknown_outcome",
    };
    input.operationStore.record(record);
    auditEvents.push(audit("EXECUTION_UNKNOWN", { reasonCode: "UNKNOWN_OUTCOME" }));
    return { ok: false, stage: "unknown_outcome", operationId, reasonCode: "UNKNOWN_OUTCOME", auditEvents };
  }

  if (raceResult.kind === "rejected") {
    const errorMessage = raceResult.error instanceof Error ? raceResult.error.message : String(raceResult.error);
    const record: OperationRecord<TReceipt> = {
      operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId: capability.id,
      payloadHash,
      state: "failed",
      errorMessage,
    };
    input.operationStore.record(record);
    return { ok: false, stage: "adapter", errorMessage, auditEvents };
  }

  const gatewayResult = raceResult.value;
  if (!gatewayResult.ok) {
    // The gateway's own capability re-check failed. Should be unreachable
    // here since this function already validated the same capability
    // against the same request — kept as a defence-in-depth backstop,
    // not a path this function's own logic is expected to take.
    const record: OperationRecord<TReceipt> = {
      operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId: capability.id,
      payloadHash,
      state: "failed",
      errorMessage: `gateway rejected: ${gatewayResult.reasonCode}`,
    };
    input.operationStore.record(record);
    return { ok: false, stage: "capability", reasonCode: gatewayResult.reasonCode, auditEvents };
  }

  return finalizeFromReceipt(input, gatewayResult.receipt, payloadHash, capability.id, false, auditEvents, audit);
}

/**
 * A duplicate idempotency-key presentation. `SUCCEEDED`/`FAILED` are
 * definite, deterministic outcomes already — replayed as-is, no new
 * adapter interaction of any kind. `UNKNOWN_OUTCOME` is the one case that
 * does something: it reconciles via `adapter.lookup`, which is READ-ONLY
 * and cannot itself cause a side effect — `adapter.execute` is never
 * called from this function. This is the literal implementation of "same
 * idempotency identity -> MUST NOT blindly invoke adapter again."
 */
async function reconcileDuplicate<TParams, TReceipt>(
  input: ExecuteActionInput<TParams, TReceipt>,
  prior: OperationRecord<TReceipt>,
  audit: (type: AuditEventType, payload: Record<string, unknown>) => AuditLedgerEntry,
): Promise<ExecuteActionResult<TReceipt>> {
  if (prior.state === "succeeded" && prior.receipt !== undefined) {
    const auditEvents = [audit("DUPLICATE_REPLAY_DETECTED", { reasonCode: "IDEMPOTENT_REPLAY" })];
    return { ok: true, receipt: prior.receipt, replay: true, operationId: prior.operationId, auditEvents, reasonCode: "IDEMPOTENT_REPLAY" };
  }
  if (prior.state === "failed") {
    return { ok: false, stage: "adapter", errorMessage: prior.errorMessage ?? "prior attempt did not succeed", auditEvents: [] };
  }

  // prior.state === "unknown_outcome": reconcile via lookup, never execute.
  const lookupResult = await input.adapter.lookup(prior.operationId);

  if (lookupResult.status === "unknown") {
    const auditEvents = [audit("RECONCILIATION_REQUIRED", { reasonCode: "UNKNOWN_OUTCOME" })];
    return { ok: false, stage: "reconciliation_required", operationId: prior.operationId, reasonCode: "UNKNOWN_OUTCOME", auditEvents };
  }

  return finalizeFromReceipt(input, lookupResult.receipt, prior.payloadHash, prior.capabilityId, true, [], audit);
}

/** Shared by the fresh-execution path and the reconciliation path: run the postcondition check, record the outcome, return the result. */
function finalizeFromReceipt<TParams, TReceipt>(
  input: ExecuteActionInput<TParams, TReceipt>,
  receipt: TReceipt,
  payloadHash: string,
  capabilityId: string,
  reconciled: boolean,
  auditEventsSoFar: readonly AuditLedgerEntry[],
  audit: (type: AuditEventType, payload: Record<string, unknown>) => AuditLedgerEntry,
): ExecuteActionResult<TReceipt> {
  const operationId = input.operation.operationId;
  const postconditionResult = verifyPostcondition(input.request.actionType, receipt, input.postcondition);
  const auditEvents = [...auditEventsSoFar];

  if (!postconditionResult.ok) {
    const record: OperationRecord<TReceipt> = {
      operationId,
      idempotencyKey: input.operation.idempotencyKey,
      capabilityId,
      payloadHash,
      state: "failed",
      errorMessage: "adapter response did not satisfy the required postcondition",
      postconditionReport: { verified: false, reasonCode: postconditionResult.reasonCode },
    };
    input.operationStore.record(record);
    auditEvents.push(audit("POSTCONDITION_FAILED", { reasonCode: postconditionResult.reasonCode }));
    return { ok: false, stage: "postcondition", reasonCode: postconditionResult.reasonCode, auditEvents };
  }

  const record: OperationRecord<TReceipt> = {
    operationId,
    idempotencyKey: input.operation.idempotencyKey,
    capabilityId,
    payloadHash,
    state: "succeeded",
    receipt,
    postconditionReport: { verified: true },
  };
  input.operationStore.record(record);
  auditEvents.push(audit("POSTCONDITION_VERIFIED", reconciled ? { reasonCode: "RECONCILED_SUCCESS" } : {}));

  return {
    ok: true,
    receipt,
    replay: reconciled,
    operationId,
    auditEvents,
    ...(reconciled ? { reasonCode: "RECONCILED_SUCCESS" as const } : {}),
  };
}
