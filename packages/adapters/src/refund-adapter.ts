import type { Capability, IssueRefundParameters, RefundReceipt } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { hashCanonical } from "@actionharbor/domain";
import type { AdapterLookupResult, AdapterOperation, AdapterPort } from "@actionharbor/gateway";
import { CapabilityActionTypeMismatchError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { validateAdapterReceipt } from "./validate-receipt.js";

interface IdempotencyRecord {
  readonly payloadHash: string;
  readonly receipt: RefundReceipt;
}

/**
 * TOOL_CONTRACTS.md: "always approval-gated and can be denied by demo
 * policy." This class has no opinion about that — approval-gating is a
 * policy/gateway concern (Gates 2, 5, 6); this adapter only ever runs once
 * a valid capability already reached it, exactly like the other two.
 *
 * Resource-version freshness ("a refund ledger record matching order
 * version") is deliberately NOT re-derived here: TOOL_CONTRACTS.md's params
 * for `issue_refund` do not include an expected version, and ACTION_MODEL.md
 * places "current resource version ... match" checking at the gateway's
 * precondition step (Gate 6/7), immediately before this adapter is ever
 * called — inventing a version parameter this contract doesn't specify
 * would just duplicate that check with an unspecified shape.
 */
export class FakeRefundAdapter implements AdapterPort<IssueRefundParameters, RefundReceipt> {
  readonly actionType = "issue_refund" as const;

  private readonly byOperationId = new Map<string, RefundReceipt>();
  private readonly byIdempotencyKey = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(operation: AdapterOperation, capability: Capability, params: IssueRefundParameters): Promise<RefundReceipt> {
    if (capability.actionType !== this.actionType) {
      throw new CapabilityActionTypeMismatchError(this.actionType, capability.actionType);
    }

    const payloadHash = hashCanonical(params);
    const existing = this.byIdempotencyKey.get(operation.idempotencyKey);

    let receipt: RefundReceipt;
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IdempotencyKeyPayloadMismatchError(operation.idempotencyKey);
      }
      receipt = existing.receipt;
    } else {
      const candidate: RefundReceipt = {
        refundId: this.idGenerator.next("rfnd"),
        orderId: params.orderId,
        amountMinorInteger: params.amountMinorInteger,
        currency: params.currency,
        reason: params.reason,
        idempotencyKey: operation.idempotencyKey,
        resourceId: capability.resourceId,
        issuedAt: this.clock.now().toISOString(),
      };

      const validated = validateAdapterReceipt(this.actionType, candidate);
      if (!validated.ok) {
        throw new Error(`FakeRefundAdapter produced an invalid receipt: ${validated.details}`);
      }
      receipt = validated.receipt as RefundReceipt;
      this.byIdempotencyKey.set(operation.idempotencyKey, { payloadHash, receipt });
    }

    this.byOperationId.set(operation.operationId, receipt);
    return receipt;
  }

  async lookup(operationId: string): Promise<AdapterLookupResult<RefundReceipt>> {
    const receipt = this.byOperationId.get(operationId);
    return receipt ? { status: "found", receipt } : { status: "unknown" };
  }
}
