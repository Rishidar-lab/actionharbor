import type { Capability, CreateInternalTicketParameters, TicketReceipt } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { hashCanonical } from "@actionharbor/domain";
import type { AdapterLookupResult, AdapterOperation, AdapterPort } from "@actionharbor/gateway";
import { assertCapabilityActive, CapabilityActionTypeMismatchError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { validateAdapterReceipt } from "./validate-receipt.js";

interface IdempotencyRecord {
  readonly payloadHash: string;
  readonly receipt: TicketReceipt;
}

/**
 * A real, stateful fake — not a hard-coded screenshot. Two independent
 * in-memory tables mirror what a genuine tool needs: one keyed by
 * idempotency key, so a replayed call with the SAME payload returns the
 * original receipt instead of minting a second ticket, and a replay with a
 * DIFFERENT payload is rejected outright (THREAT_MODEL.md "Replay /
 * duplicate") rather than silently overwriting; one keyed by operationId,
 * what `lookup()` serves — independent of whether the caller still has the
 * idempotency key (used for `UNKNOWN_OUTCOME` reconciliation at Gate 7).
 */
export class FakeTicketAdapter implements AdapterPort<CreateInternalTicketParameters, TicketReceipt> {
  readonly actionType = "create_internal_ticket" as const;

  private readonly byOperationId = new Map<string, TicketReceipt>();
  private readonly byIdempotencyKey = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(operation: AdapterOperation, capability: Capability, params: CreateInternalTicketParameters): Promise<TicketReceipt> {
    if (capability.actionType !== this.actionType) {
      throw new CapabilityActionTypeMismatchError(this.actionType, capability.actionType);
    }
    assertCapabilityActive(capability, this.clock.now());

    const payloadHash = hashCanonical(params);
    const existing = this.byIdempotencyKey.get(operation.idempotencyKey);

    let receipt: TicketReceipt;
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyKeyPayloadMismatchError(operation.idempotencyKey);
      }
      receipt = existing.receipt;
    } else {
      const candidate: TicketReceipt = {
        ticketId: this.idGenerator.next("tix"),
        status: "open",
        title: params.title,
        ...(params.description !== undefined ? { description: params.description } : {}),
        priority: params.priority ?? "medium",
        idempotencyKey: operation.idempotencyKey,
        resourceId: capability.resourceId,
        createdAt: this.clock.now().toISOString(),
      };

      const validated = validateAdapterReceipt(this.actionType, candidate);
      if (!validated.ok) {
        // Only reachable if this adapter's construction logic drifted out
        // of sync with TicketReceipt's schema — a bug here, not caller input.
        throw new Error(`FakeTicketAdapter produced an invalid receipt: ${validated.details}`);
      }
      receipt = validated.receipt as TicketReceipt;
      this.byIdempotencyKey.set(operation.idempotencyKey, { payloadHash, receipt });
    }

    // Registered under THIS call's operationId even on an idempotent
    // replay, so a lookup(operationId) for this specific call always
    // resolves — regardless of which operationId first created the ticket.
    this.byOperationId.set(operation.operationId, receipt);
    return receipt;
  }

  async lookup(operationId: string): Promise<AdapterLookupResult<TicketReceipt>> {
    const receipt = this.byOperationId.get(operationId);
    return receipt ? { status: "found", receipt } : { status: "unknown" };
  }
}
