import type { Capability, MessageReceipt, SendCustomerMessageParameters } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { hashCanonical } from "@actionharbor/domain";
import type { AdapterLookupResult, AdapterOperation, AdapterPort } from "@actionharbor/gateway";
import { CapabilityActionTypeMismatchError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { validateAdapterReceipt } from "./validate-receipt.js";

interface IdempotencyRecord {
  readonly payloadHash: string;
  readonly receipt: MessageReceipt;
}

/**
 * TOOL_CONTRACTS.md: "postcondition is an immutable message receipt;
 * compensation is a follow-up correction, not deletion." There is
 * deliberately no delete/retract method on this class — once a message
 * receipt exists in `byOperationId` it is never removed or replaced, only
 * ever looked up.
 */
export class FakeMessageAdapter implements AdapterPort<SendCustomerMessageParameters, MessageReceipt> {
  readonly actionType = "send_customer_message" as const;

  private readonly byOperationId = new Map<string, MessageReceipt>();
  private readonly byIdempotencyKey = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(operation: AdapterOperation, capability: Capability, params: SendCustomerMessageParameters): Promise<MessageReceipt> {
    if (capability.actionType !== this.actionType) {
      throw new CapabilityActionTypeMismatchError(this.actionType, capability.actionType);
    }

    const payloadHash = hashCanonical(params);
    const existing = this.byIdempotencyKey.get(operation.idempotencyKey);

    let receipt: MessageReceipt;
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyKeyPayloadMismatchError(operation.idempotencyKey);
      }
      receipt = existing.receipt;
    } else {
      const candidate: MessageReceipt = {
        messageId: this.idGenerator.next("msg"),
        customerId: params.customerId,
        body: params.body,
        channel: params.channel,
        idempotencyKey: operation.idempotencyKey,
        resourceId: capability.resourceId,
        sentAt: this.clock.now().toISOString(),
      };

      const validated = validateAdapterReceipt(this.actionType, candidate);
      if (!validated.ok) {
        throw new Error(`FakeMessageAdapter produced an invalid receipt: ${validated.details}`);
      }
      receipt = validated.receipt as MessageReceipt;
      this.byIdempotencyKey.set(operation.idempotencyKey, { payloadHash, receipt });
    }

    this.byOperationId.set(operation.operationId, receipt);
    return receipt;
  }

  async lookup(operationId: string): Promise<AdapterLookupResult<MessageReceipt>> {
    const receipt = this.byOperationId.get(operationId);
    return receipt ? { status: "found", receipt } : { status: "unknown" };
  }
}
