import type { Capability, SendCustomerMessageParameters } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityActionTypeMismatchError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { FakeMessageAdapter } from "./message-adapter.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_1",
    principalId: "principal-1",
    actionType: "send_customer_message",
    resourceId: "customer-1",
    proposalHash: "hash-1",
    expiresAt: "2026-08-22T09:05:00Z",
    nonce: "nonce-1",
    status: "active",
    ...overrides,
  };
}

const PARAMS: SendCustomerMessageParameters = {
  customerId: "customer-1",
  body: "Your delivery is delayed.",
  channel: "email",
};

describe("FakeMessageAdapter", () => {
  let adapter: FakeMessageAdapter;

  beforeEach(() => {
    adapter = new FakeMessageAdapter(new CounterIdGenerator(), new FixedClock(NOW));
  });

  it("TOOL_CONTRACTS.md postcondition: produces an immutable message receipt", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(receipt).toMatchObject({
      customerId: "customer-1",
      body: "Your delivery is delayed.",
      channel: "email",
      idempotencyKey: "key-1",
      resourceId: "customer-1",
    });
    expect(receipt.messageId).toBeTruthy();
  });

  it("replaying the same idempotency key with the same payload returns the same receipt, not a second message", async () => {
    const first = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    const second = await adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(second.messageId).toBe(first.messageId);
  });

  it("replaying the same idempotency key with a different body is rejected", async () => {
    await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    await expect(
      adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), { ...PARAMS, body: "A different message." }),
    ).rejects.toThrow(IdempotencyKeyPayloadMismatchError);
  });

  it("defence in depth: rejects a capability minted for a different action type", async () => {
    await expect(
      adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability({ actionType: "create_internal_ticket" }), PARAMS),
    ).rejects.toThrow(CapabilityActionTypeMismatchError);
  });

  it("lookup() reflects the same store execute() writes to", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(await adapter.lookup("op_1")).toEqual({ status: "found", receipt });
    expect(await adapter.lookup("nonexistent")).toEqual({ status: "unknown" });
  });
});
