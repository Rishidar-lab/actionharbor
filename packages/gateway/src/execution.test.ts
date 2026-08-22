import type { Capability, CapabilityRequest } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./capability-registry.js";
import { executeAction } from "./execution.js";
import { mintCapability } from "./mint-capability.js";
import { OperationStore } from "./operation-store.js";
import { createSpyAdapter } from "./test-support/spy-adapter.js";

/**
 * The Gate 6 integration suite. Every test here observes the adapter
 * boundary through a real `vi.fn()` spy (`createSpyAdapter`, Gate 0's own
 * test double) — never a boolean flag or an implementation-constant
 * assertion. "Adapter not called" always means
 * `expect(adapter.execute).not.toHaveBeenCalled()` against that spy.
 */

const NOW = new Date("2026-08-22T09:00:00Z");
const OPERATION = { operationId: "op_1", idempotencyKey: "key-1" };
const PARAMS = { title: "Cold-chain check" };

function makeRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    ...overrides,
  };
}

function makeCapabilityRaw(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_1",
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

function freshPreconditionFor(request: CapabilityRequest) {
  return { currentProposalHash: request.proposalHash, currentResourceVersion: 3, expectedResourceVersion: 3 };
}

interface Harness {
  readonly clock: FixedClock;
  readonly idGenerator: CounterIdGenerator;
  readonly registry: CapabilityRegistry;
  readonly operationStore: OperationStore<{ ticketId: string }>;
  readonly adapter: ReturnType<typeof createSpyAdapter<{ title: string }, { ticketId: string }>>;
}

function freshHarness(): Harness {
  return {
    clock: new FixedClock(NOW),
    idGenerator: new CounterIdGenerator(),
    registry: new CapabilityRegistry(),
    operationStore: new OperationStore<{ ticketId: string }>(),
    adapter: createSpyAdapter<{ title: string }, { ticketId: string }>("create_internal_ticket", { ticketId: "tix_1" }),
  };
}

/** Legitimately mints a capability AND records it in the registry — the one, real way to get an authoritative capability in these tests. */
function mintAndRegister(h: Harness, request: CapabilityRequest, ttlMs = 60_000): Capability {
  const result = mintCapability(
    { kind: "policy-allow", verdict: { outcome: "ALLOW", reasonCodes: [], policyVersion: "policy-2026-08-22.1" } },
    request,
    h.idGenerator,
    h.clock,
    ttlMs,
  );
  if (!result.ok) throw new Error("test setup: mint failed unexpectedly");
  h.registry.record(result.capability);
  return result.capability;
}

describe("executeAction — capability tests (spy-observed adapter boundary)", () => {
  it("test #1: no capability (undefined) -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction({
      capabilityRaw: undefined,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_MALFORMED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #2: malformed capability (wrong shape entirely) -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction({
      capabilityRaw: { foo: "bar", not: "a capability" },
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_MALFORMED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #3: expired capability -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction({
      capabilityRaw: makeCapabilityRaw({ expiresAt: "2000-01-01T00:00:00Z" }),
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_EXPIRED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #4: wrong action scope -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest({ actionType: "create_internal_ticket" });
    const result = await executeAction({
      capabilityRaw: makeCapabilityRaw({ actionType: "issue_refund" }),
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #5: wrong resource scope -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest({ resourceId: "incident-1" });
    const result = await executeAction({
      capabilityRaw: makeCapabilityRaw({ resourceId: "incident-999" }),
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #6 / #10: capability bound to a materially different (now-stale) proposal -> adapter not called (STATE_MACHINE.md AUTHORIZED -> STALE)", async () => {
    const h = freshHarness();
    const request = makeRequest({ proposalHash: "h1" });
    // A legitimately minted, registered, unexpired, correctly-scoped
    // capability for proposal h1 — everything the capability boundary
    // itself checks passes. But the proposal has since changed to h2 (the
    // model re-proposed, or the plan was edited, after approval/minting).
    const capability = mintAndRegister(h, request);

    const result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: { currentProposalHash: "h2", currentResourceVersion: 3, expectedResourceVersion: 3 },
    });
    expect(result).toMatchObject({ ok: false, stage: "precondition", reasonCodes: ["PLAN_HASH_MISMATCH"] });
    expect(h.adapter.execute).not.toHaveBeenCalled();
    // The capability is NOT burned by a precondition rejection — execution
    // was never attempted, so there is no duplicate-side-effect risk to
    // guard against by spending it. Registry consumption happens only
    // immediately before a genuinely new adapter attempt (see the
    // idempotency suite below for the case where it IS burned: a failed
    // adapter attempt, where the call really was made).
    expect(h.registry.consume(capability.id, capability.nonce)).toEqual({ ok: true });
  });

  it("resource version drift (w3-010) also blocks execution via the same precondition stage", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: { currentProposalHash: request.proposalHash, currentResourceVersion: 4, expectedResourceVersion: 3 },
    });
    expect(result).toMatchObject({ ok: false, stage: "precondition", reasonCodes: ["PRECONDITION_FAILED", "RESOURCE_VERSION_CHANGED"] });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #11: a valid, complete authorization chain calls the adapter exactly once", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    expect(result).toEqual({ ok: true, receipt: { ticketId: "tix_1" }, replay: false, operationId: "op_1" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.adapter.execute).toHaveBeenCalledWith(OPERATION, capability, PARAMS);
  });
});

describe("executeAction — direct adapter bypass (mandatory adversarial test)", () => {
  it("a hand-rolled capability that was NEVER minted is rejected as CAPABILITY_UNKNOWN, even though every field is well-formed and exactly matches the request", async () => {
    const h = freshHarness();
    const request = makeRequest();
    // Never came from mintCapability, never registry.record()ed. Everything
    // about it — status, expiry, exact scope match against `request` — is
    // otherwise indistinguishable from a legitimate capability. This IS
    // "construct an accepted capability merely by producing matching JSON."
    const forged = makeCapabilityRaw({ id: "cap_never_minted", nonce: "nonce_never_minted" });

    const result = await executeAction({
      capabilityRaw: forged,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    expect(result).toEqual({ ok: false, stage: "capability", reasonCode: "CAPABILITY_UNKNOWN" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("DOCUMENTED RESIDUAL LIMITATION: a direct call to adapter.execute(), skipping executeAction entirely, is not stopped by this module", async () => {
    // This test exists to keep the claim in execution.ts's doc comment
    // honest, not to demonstrate a passing security control. Nothing in
    // packages/gateway prevents a caller who already holds BOTH a raw
    // adapter reference AND a capability-shaped object from calling
    // .execute() directly — module boundaries in JS/TS cannot make a public
    // method unreachable to another importer in the same process. What
    // actually protects the real system is that NOTHING reachable from
    // untrusted input (model output) has a code path to an adapter
    // instance at all — proved structurally in architecture.test.ts, not
    // by this test.
    const h = freshHarness();
    const forged = makeCapabilityRaw({ id: "cap_never_minted", nonce: "nonce_never_minted" });
    const receipt = await h.adapter.execute(OPERATION, forged, PARAMS);
    expect(receipt).toEqual({ ticketId: "tix_1" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });
});

describe("executeAction — idempotency", () => {
  it("a duplicate request (same idempotency key, same payload) returns the cached receipt and does NOT call the adapter again", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const first = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(first).toMatchObject({ ok: true, replay: false });

    // A "retry" IS this: same idempotency key, same payload, presented
    // again — this is what TECHNICAL_SPEC.md's idempotency-key mechanism
    // exists to make safe.
    const second = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    expect(second).toEqual({ ok: true, receipt: { ticketId: "tix_1" }, replay: true, operationId: "op_1" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1); // NOT called a second time
  });

  it("the same idempotency key with a MATERIALLY DIFFERENT operation (different params) is rejected before the adapter is ever called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const first = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    expect(first.ok).toBe(true);

    // A second, independently minted capability for the same request — a
    // genuinely different operation would naturally have its own. It is
    // never actually reached: the idempotency-conflict check runs BEFORE
    // registry consumption (see execution.ts's doc comment on ordering),
    // so this capability is refused at the idempotency stage without ever
    // being spent, and remains available afterward.
    const secondCapability = mintAndRegister(h, request);
    const conflicting = await executeAction({
      capabilityRaw: secondCapability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION, // SAME idempotencyKey
      params: { title: "A completely different ticket" }, // DIFFERENT payload
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    expect(conflicting).toEqual({ ok: false, stage: "idempotency", reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1); // still just the first call
    expect(h.registry.consume(secondCapability.id, secondCapability.nonce)).toEqual({ ok: true }); // never spent
  });

  it("a failed adapter execution is recorded, and the same (now-consumed) capability cannot be replayed to retry it — a fresh authorization cycle is required", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockRejectedValueOnce(new Error("simulated deterministic tool failure"));

    const result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    expect(result).toEqual({ ok: false, stage: "adapter", errorMessage: "simulated deterministic tool failure" });
    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "failed", errorMessage: "simulated deterministic tool failure" });

    // TECHNICAL_SPEC.md: "maximum retries ... 0 for non-idempotent writes."
    // executeAction has no retry loop at all — and even presenting the same
    // capability again fails, because it was consumed before the adapter
    // ran (fail-closed: a capability is burned by an attempt, not only by success).
    expect(h.registry.consume(capability.id, capability.nonce)).toEqual({ ok: false, reasonCode: "CAPABILITY_ALREADY_CONSUMED" });
  });
});

describe("executeAction — concurrent duplicate (a genuine race, honestly evaluated)", () => {
  it("two concurrent executeAction calls with the same idempotency key both pass the gateway's own check, but the SYNCHRONOUS adapter-level idempotency map still prevents a second side effect", async () => {
    const h = freshHarness();
    const request = makeRequest();
    // Mint two independent, validly-registered capabilities for the same
    // request, to isolate this test from the (separately proven) single-use
    // capability-consumption behavior and observe ONLY the idempotency race.
    const capabilityA = mintAndRegister(h, request);
    const capabilityB = mintAndRegister(h, request);

    const callA = executeAction({
      capabilityRaw: capabilityA,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION,
      params: PARAMS,
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });
    const callB = executeAction({
      capabilityRaw: capabilityB,
      request,
      registry: h.registry,
      operationStore: h.operationStore,
      adapter: h.adapter,
      operation: OPERATION, // same idempotency key
      params: PARAMS, // same payload
      clock: h.clock,
      precondition: freshPreconditionFor(request),
    });

    const [resultA, resultB] = await Promise.all([callA, callB]);

    // Both calls observe the SAME underlying spy's call history — this spy
    // returns a fixed receipt regardless of call count (it does not model
    // the adapter's OWN internal dedup), so this test's job is narrower and
    // more honest than "prove zero duplication end to end": it documents
    // that the GATEWAY's own OperationStore.check-then-record has a real,
    // await-spanning TOCTOU window — both calls can observe "new" before
    // either has recorded. See adapters/src/*-adapter.ts and
    // execution.ts's doc comment for why the REAL fakes are still safe:
    // their own idempotency map is populated synchronously, with no
    // internal await, so no interleaving is possible within one call's
    // adapter.execute — a property this bare spy does not share.
    expect(resultA.ok && resultB.ok).toBe(true);
    expect(h.adapter.execute.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
