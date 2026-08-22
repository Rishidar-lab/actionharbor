import type { Capability, CapabilityRequest } from "@actionharbor/contracts";
import { FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { invokeAdapter } from "./gateway.js";
import { createSpyAdapter } from "./test-support/spy-adapter.js";

/**
 * SECURITY INVARIANT (P0): NO ADAPTER CALL WITHOUT A VALID CAPABILITY.
 *
 * These tests exist to make one thing structurally true: whenever the
 * capability presented to `invokeAdapter` is not exactly the one minted for
 * this call, the real adapter object's `execute` method is never invoked —
 * not "invoked with an error", never called at all. That is checked against
 * a `vi.fn()` spy on a real adapter double, not a boolean flag the gateway
 * sets itself.
 */

const NOW = new Date("2026-08-22T09:00:00Z");
const CLOCK = new FixedClock(NOW);

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_000001",
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    expiresAt: "2026-08-22T09:05:00Z",
    nonce: "nonce-1",
    status: "active",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    ...overrides,
  };
}

const OPERATION = { operationId: "op_000001", idempotencyKey: "key-1" };
const PARAMS = { title: "Cold-chain check" };

describe("invokeAdapter — capability gate", () => {
  it("calls the adapter exactly once when the capability is valid and exactly scoped", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    const result = await invokeAdapter({
      capability: makeCapability(),
      request: makeRequest(),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: true, receipt: { ticketId: "tix_1" } });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.execute).toHaveBeenCalledWith(OPERATION, makeCapability(), PARAMS);
  });

  it("NEVER calls the adapter when no capability was minted for this call (absent/undefined)", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    await expect(
      invokeAdapter({
        // @ts-expect-error — deliberately simulating a call site that forgot to mint a capability.
        capability: undefined,
        request: makeRequest(),
        adapter,
        operation: OPERATION,
        params: PARAMS,
        clock: CLOCK,
      }),
    ).rejects.toThrow();

    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("does not call the adapter when the capability is expired", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    const result = await invokeAdapter({
      capability: makeCapability({ expiresAt: "2026-08-22T08:59:59Z" }),
      request: makeRequest(),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_EXPIRED" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("does not call the adapter when the capability was revoked", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    const result = await invokeAdapter({
      capability: makeCapability({ status: "revoked" }),
      request: makeRequest(),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_STATUS_INVALID" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("does not call the adapter when the capability was minted for a different resource (w3-017: wrong resource capability)", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    const result = await invokeAdapter({
      capability: makeCapability({ resourceId: "order-1" }),
      request: makeRequest({ resourceId: "order-2" }),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("does not call the adapter when the capability was minted for a different action type", async () => {
    const adapter = createSpyAdapter<typeof PARAMS, { ok: boolean }>("issue_refund", { ok: true });

    const result = await invokeAdapter({
      capability: makeCapability({ actionType: "create_internal_ticket" }),
      request: makeRequest({ actionType: "issue_refund" }),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("does not call the adapter when the plan hash changed after the capability was minted (stale plan)", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    const result = await invokeAdapter({
      capability: makeCapability({ proposalHash: "h1" }),
      request: makeRequest({ proposalHash: "h2" }),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it("a rejected call never touches lookup() either — the adapter boundary is fully untouched on denial", async () => {
    const adapter = createSpyAdapter("create_internal_ticket", { ticketId: "tix_1" });

    await invokeAdapter({
      capability: makeCapability({ status: "consumed" }),
      request: makeRequest(),
      adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: CLOCK,
    });

    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.lookup).not.toHaveBeenCalled();
  });
});
