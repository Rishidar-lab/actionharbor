import type { Capability, CreateInternalTicketParameters } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityActionTypeMismatchError, IdempotencyKeyPayloadMismatchError } from "./errors.js";
import { FakeTicketAdapter } from "./ticket-adapter.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_1",
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-1",
    expiresAt: "2026-08-22T09:05:00Z",
    nonce: "nonce-1",
    status: "active",
    ...overrides,
  };
}

const PARAMS: CreateInternalTicketParameters = { title: "Cold-chain check", priority: "high" };

describe("FakeTicketAdapter", () => {
  let adapter: FakeTicketAdapter;

  beforeEach(() => {
    adapter = new FakeTicketAdapter(new CounterIdGenerator(), new FixedClock(NOW));
  });

  it("TOOL_CONTRACTS.md postcondition: creates a ticket with matching idempotency key and status open", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(receipt.status).toBe("open");
    expect(receipt.idempotencyKey).toBe("key-1");
    expect(receipt.title).toBe("Cold-chain check");
    expect(receipt.priority).toBe("high");
    expect(receipt.resourceId).toBe("incident-1");
  });

  it("lookup() is unknown before execute() and found after, keyed by operationId", async () => {
    expect(await adapter.lookup("op_1")).toEqual({ status: "unknown" });
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(await adapter.lookup("op_1")).toEqual({ status: "found", receipt });
  });

  it("replaying the same idempotency key with the identical payload returns the SAME ticket, not a new one", async () => {
    const first = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    const second = await adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(second.ticketId).toBe(first.ticketId);
    expect(second).toEqual(first);
  });

  it("a replay under a NEW operationId still resolves via lookup() for that operationId (not just the original)", async () => {
    await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    const second = await adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    expect(await adapter.lookup("op_2")).toEqual({ status: "found", receipt: second });
  });

  it("replaying the same idempotency key with a DIFFERENT payload is rejected, not silently accepted", async () => {
    await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    await expect(
      adapter.execute({ operationId: "op_2", idempotencyKey: "key-1" }, makeCapability(), { title: "A different title" }),
    ).rejects.toThrow(IdempotencyKeyPayloadMismatchError);
  });

  it("two different idempotency keys with the same payload create two distinct tickets", async () => {
    const first = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), PARAMS);
    const second = await adapter.execute({ operationId: "op_2", idempotencyKey: "key-2" }, makeCapability(), PARAMS);
    expect(second.ticketId).not.toBe(first.ticketId);
  });

  it("defence in depth: rejects a capability minted for a different action type, even though the gateway should have already excluded this", async () => {
    await expect(
      adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability({ actionType: "issue_refund" }), PARAMS),
    ).rejects.toThrow(CapabilityActionTypeMismatchError);
  });

  it("resourceId on the receipt comes from the capability, not from caller-supplied params (params has no resourceId field at all)", async () => {
    const receipt = await adapter.execute(
      { operationId: "op_1", idempotencyKey: "key-1" },
      makeCapability({ resourceId: "incident-42" }),
      PARAMS,
    );
    expect(receipt.resourceId).toBe("incident-42");
  });

  it("description is omitted from the receipt entirely when not supplied, not stored as undefined", async () => {
    const receipt = await adapter.execute({ operationId: "op_1", idempotencyKey: "key-1" }, makeCapability(), {
      title: "x",
    });
    expect("description" in receipt).toBe(false);
  });
});
