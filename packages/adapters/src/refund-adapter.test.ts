import type { Capability, IssueRefundParameters } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityActionTypeMismatchError, CapabilityNotActiveError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { FakeRefundAdapter } from "./refund-adapter.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_1",
    principalId: "finance-1",
    actionType: "issue_refund",
    resourceId: "order-1",
    proposalHash: "hash-1",
    expiresAt: "2026-08-22T09:05:00Z",
    nonce: "nonce-1",
    status: "active",
    ...overrides,
  };
}

const PARAMS: IssueRefundParameters = {
  orderId: "order-1",
  amountMinorInteger: 2500,
  currency: "USD",
  reason: "Cold-chain failure",
};

describe("FakeRefundAdapter", () => {
  let adapter: FakeRefundAdapter;

  beforeEach(() => {
    adapter = new FakeRefundAdapter(new CounterIdGenerator(), new FixedClock(NOW));
  });

  it("TOOL_CONTRACTS.md postcondition: produces a refund ledger record matching the requested amount", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(receipt).toMatchObject({
      orderId: "order-1",
      amountMinorInteger: 2500,
      currency: "USD",
      reason: "Cold-chain failure",
      idempotencyKey: "key-1",
      resourceId: "order-1",
    });
    expect(receipt.refundId).toBeTruthy();
  });

  it("replaying the same idempotency key with the same amount returns the same refund, never a double payout", async () => {
    const first = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    const second = await adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(second.refundId).toBe(first.refundId);
  });

  it("replaying the same idempotency key with a DIFFERENT amount is rejected — the highest-stakes case in the whole system", async () => {
    await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    await expect(
      adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), { ...PARAMS, amountMinorInteger: 999_999 }),
    ).rejects.toThrow(IdempotencyKeyPayloadMismatchError);
  });

  it("defence in depth: rejects a capability minted for a different action type", async () => {
    await expect(
      adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability({ actionType: "send_customer_message" }), PARAMS),
    ).rejects.toThrow(CapabilityActionTypeMismatchError);
  });

  it("lookup() reflects the same store execute() writes to", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(await adapter.lookup("op_1")).toEqual({ status: "found", receipt });
  });

  it("Gate 6 defence in depth: rejects an expired capability even when called directly — the highest-stakes adapter, checked explicitly", async () => {
    await expect(
      adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability({ expiresAt: "2000-01-01T00:00:00Z" }), PARAMS),
    ).rejects.toThrow(CapabilityNotActiveError);
  });
});
