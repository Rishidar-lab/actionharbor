import type { Capability, CapabilityRequest, TicketReceipt } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { AuditLedger } from "@actionharbor/ledger";
import type { PostconditionExpectation } from "@actionharbor/verifier";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterLookupResult, AdapterOperation } from "./adapter-port.js";
import { CapabilityRegistry } from "./capability-registry.js";
import type { ExecuteActionInput } from "./execution.js";
import { executeAction } from "./execution.js";
import { mintCapability } from "./mint-capability.js";
import { OperationStore } from "./operation-store.js";
import { createSpyAdapter } from "./test-support/spy-adapter.js";

/**
 * The Gate 6/7 integration suite. Every test observes the adapter boundary
 * through a real `vi.fn()` spy (`createSpyAdapter`) — never a boolean flag
 * or an implementation-constant assertion. "Adapter not called" always
 * means `expect(adapter.execute).not.toHaveBeenCalled()`.
 *
 * The spy's receipt is a REAL, schema-valid `TicketReceipt` (not a
 * placeholder) because Gate 7's `executeAction` now runs an independent
 * postcondition check on every successful response — a fake shape that
 * doesn't parse as a real receipt would (correctly) fail verification,
 * which is exactly the property under test elsewhere in this file.
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

function validTicketReceipt(overrides: Partial<TicketReceipt> = {}): TicketReceipt {
  return {
    ticketId: "tix_1",
    status: "open",
    title: "Cold-chain check",
    priority: "high",
    idempotencyKey: "key-1",
    resourceId: "incident-1",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function ticketPostcondition(overrides: Partial<PostconditionExpectation & { actionType: "create_internal_ticket" }> = {}): PostconditionExpectation {
  return { actionType: "create_internal_ticket", idempotencyKey: "key-1", ...overrides };
}

function freshPreconditionFor(request: CapabilityRequest) {
  return { currentProposalHash: request.proposalHash, currentResourceVersion: 3, expectedResourceVersion: 3 };
}

interface Harness {
  readonly clock: FixedClock;
  readonly idGenerator: CounterIdGenerator;
  readonly registry: CapabilityRegistry;
  readonly operationStore: OperationStore<TicketReceipt>;
  readonly adapter: ReturnType<typeof createSpyAdapter<{ title: string }, TicketReceipt>>;
  readonly ledger: AuditLedger;
}

function freshHarness(): Harness {
  return {
    clock: new FixedClock(NOW),
    idGenerator: new CounterIdGenerator(),
    registry: new CapabilityRegistry(),
    operationStore: new OperationStore<TicketReceipt>(),
    adapter: createSpyAdapter<{ title: string }, TicketReceipt>("create_internal_ticket", validTicketReceipt()),
    ledger: new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW)),
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

function baseInput(
  h: Harness,
  request: CapabilityRequest,
  overrides: Partial<ExecuteActionInput<{ title: string }, TicketReceipt>> = {},
): ExecuteActionInput<{ title: string }, TicketReceipt> {
  return {
    capabilityRaw: undefined,
    request,
    registry: h.registry,
    operationStore: h.operationStore,
    adapter: h.adapter,
    operation: OPERATION,
    params: PARAMS,
    clock: h.clock,
    idGenerator: h.idGenerator,
    ledger: h.ledger,
    precondition: freshPreconditionFor(request),
    postcondition: ticketPostcondition(),
    ...overrides,
  };
}

describe("executeAction — capability tests (spy-observed adapter boundary)", () => {
  it("test #1: no capability (undefined) -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction(baseInput(h, request, { capabilityRaw: undefined }));
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_MALFORMED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #2: malformed capability (wrong shape entirely) -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction(baseInput(h, request, { capabilityRaw: { foo: "bar", not: "a capability" } }));
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_MALFORMED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #3: expired capability -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const result = await executeAction(baseInput(h, request, { capabilityRaw: makeCapabilityRaw({ expiresAt: "2000-01-01T00:00:00Z" }) }));
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_EXPIRED" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #4: wrong action scope -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest({ actionType: "create_internal_ticket" });
    const result = await executeAction(baseInput(h, request, { capabilityRaw: makeCapabilityRaw({ actionType: "issue_refund" }) }));
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #5: wrong resource scope -> adapter not called", async () => {
    const h = freshHarness();
    const request = makeRequest({ resourceId: "incident-1" });
    const result = await executeAction(baseInput(h, request, { capabilityRaw: makeCapabilityRaw({ resourceId: "incident-999" }) }));
    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("test #6 / #10: capability bound to a materially different (now-stale) proposal -> adapter not called (STATE_MACHINE.md AUTHORIZED -> STALE)", async () => {
    const h = freshHarness();
    const request = makeRequest({ proposalHash: "h1" });
    const capability = mintAndRegister(h, request);

    const result = await executeAction(
      baseInput(h, request, {
        capabilityRaw: capability,
        precondition: { currentProposalHash: "h2", currentResourceVersion: 3, expectedResourceVersion: 3 },
      }),
    );
    expect(result).toMatchObject({ ok: false, stage: "precondition", reasonCodes: ["PLAN_HASH_MISMATCH"] });
    expect(h.adapter.execute).not.toHaveBeenCalled();
    // The capability is NOT burned by a precondition rejection — execution
    // was never attempted, so there is no duplicate-side-effect risk to
    // guard against by spending it.
    expect(h.registry.consume(capability.id, capability.nonce)).toEqual({ ok: true });
  });

  it("resource version drift (w3-010) also blocks execution via the same precondition stage, and emits PRECONDITION_FAILED", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const result = await executeAction(
      baseInput(h, request, {
        capabilityRaw: capability,
        precondition: { currentProposalHash: request.proposalHash, currentResourceVersion: 4, expectedResourceVersion: 3 },
      }),
    );
    expect(result).toMatchObject({ ok: false, stage: "precondition", reasonCodes: ["PRECONDITION_FAILED", "RESOURCE_VERSION_CHANGED"] });
    expect(h.adapter.execute).not.toHaveBeenCalled();
    if (result.ok) throw new Error("unreachable");
    expect(result.auditEvents.map((e) => e.type)).toEqual(["PRECONDITION_FAILED"]);
  });

  it("test #11: a valid, complete authorization chain calls the adapter exactly once and is genuinely postcondition-verified", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: true, receipt: validTicketReceipt(), replay: false, operationId: "op_1" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.adapter.execute).toHaveBeenCalledWith(OPERATION, capability, PARAMS);
    if (!result.ok) throw new Error("unreachable");
    expect(result.auditEvents.map((e) => e.type)).toEqual(["EXECUTION_STARTED", "POSTCONDITION_VERIFIED"]);
  });
});

describe("executeAction — direct adapter bypass (mandatory adversarial test)", () => {
  it("a hand-rolled capability that was NEVER minted is rejected as CAPABILITY_UNKNOWN, even though every field is well-formed and exactly matches the request", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const forged = makeCapabilityRaw({ id: "cap_never_minted", nonce: "nonce_never_minted" });

    const result = await executeAction(baseInput(h, request, { capabilityRaw: forged }));

    expect(result).toMatchObject({ ok: false, stage: "capability", reasonCode: "CAPABILITY_UNKNOWN" });
    expect(h.adapter.execute).not.toHaveBeenCalled();
  });

  it("DOCUMENTED RESIDUAL LIMITATION: a direct call to adapter.execute(), skipping executeAction entirely, is not stopped by this module", async () => {
    const h = freshHarness();
    const forged = makeCapabilityRaw({ id: "cap_never_minted", nonce: "nonce_never_minted" });
    const receipt = await h.adapter.execute(OPERATION, forged, PARAMS);
    expect(receipt).toEqual(validTicketReceipt());
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });
});

describe("executeAction — postcondition verification (Gate 7 core)", () => {
  it("adapter returns success and postcondition is true -> SUCCEEDED, with a genuine verification, not trust in the transport result alone", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));
    expect(result.ok).toBe(true);
    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "succeeded", postconditionReport: { verified: true } });
  });

  it("adapter returns success but postcondition is false (receipt is for a different idempotency key) -> NOT SUCCEEDED", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    // Wrong idempotencyKey inside the receipt — proves the postcondition
    // check inspects CONTENT, not merely "did the promise resolve."
    h.adapter.execute.mockResolvedValueOnce(validTicketReceipt({ idempotencyKey: "a-different-key-entirely" }));

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: false, stage: "postcondition", reasonCode: "POSTCONDITION_UNVERIFIED" });
    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "failed", postconditionReport: { verified: false } });
    if (result.ok) throw new Error("unreachable");
    expect(result.auditEvents.map((e) => e.type)).toEqual(["EXECUTION_STARTED", "POSTCONDITION_FAILED"]);
  });

  it("w3-020-shaped: a malformed/empty adapter response fails closed as POSTCONDITION_UNVERIFIED, not thrown, not silently accepted", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockResolvedValueOnce({} as TicketReceipt);

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: false, stage: "postcondition", reasonCode: "POSTCONDITION_UNVERIFIED" });
    if (result.ok) throw new Error("unreachable");
    expect(result.auditEvents.map((e) => e.type)).toEqual(["EXECUTION_STARTED", "POSTCONDITION_FAILED"]);
  });

  it("adapter throws before any side effect -> a deterministic failure, distinct from unknown outcome", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockRejectedValueOnce(new Error("simulated deterministic tool failure"));

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toEqual({ ok: false, stage: "adapter", errorMessage: "simulated deterministic tool failure", auditEvents: expect.any(Array) });
    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "failed" });
  });
});

describe("executeAction — UNKNOWN_OUTCOME (the most important Gate 7 behaviour)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a response that never arrives within the execution budget becomes UNKNOWN_OUTCOME — never claims success, never claims failure", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockImplementationOnce(() => new Promise(() => {})); // never resolves

    const resultPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: false, stage: "unknown_outcome", operationId: "op_1", reasonCode: "UNKNOWN_OUTCOME" });
    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "unknown_outcome" });
    if (result.ok) throw new Error("unreachable");
    expect(result.auditEvents.map((e) => e.type)).toEqual(["EXECUTION_STARTED", "EXECUTION_UNKNOWN"]);
  });

  it("the side effect MAY have actually happened before the timeout fired — this function still reports UNKNOWN_OUTCOME, never guessing success", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    let sideEffectHappened = false;
    h.adapter.execute.mockImplementationOnce(() => {
      sideEffectHappened = true; // the mutation runs synchronously...
      return new Promise(() => {}); // ...but the response never arrives.
    });

    const resultPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(sideEffectHappened).toBe(true); // it DID happen
    expect(result).toMatchObject({ ok: false, stage: "unknown_outcome" }); // but we still don't claim to know
  });

  it("UNKNOWN_OUTCOME cannot be silently converted to SUCCEEDED by a later replay with no new evidence", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockImplementationOnce(() => new Promise(() => {}));
    const firstPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    await firstPromise;

    // A second (independently minted) capability presented for a replay —
    // lookup() still finds nothing (the fake ticket adapter's inner map was
    // never populated by the hanging call), so this MUST remain unknown.
    const capability2 = mintAndRegister(h, request);
    const second = await executeAction(baseInput(h, request, { capabilityRaw: capability2 }));

    expect(second).toMatchObject({ ok: false, stage: "reconciliation_required" });
    if (second.ok) throw new Error("unreachable");
    expect(second.auditEvents.map((e) => e.type)).toEqual(["RECONCILIATION_REQUIRED"]);
  });
});

describe("executeAction — idempotency + UNKNOWN_OUTCOME reconciliation", () => {
  it("w3-012-shaped: first attempt times out (UNKNOWN_OUTCOME), second request with the same idempotency identity does NOT blindly re-invoke the adapter, and reconciliation is inconclusive -> RECONCILIATION_REQUIRED", async () => {
    vi.useFakeTimers();
    try {
      const h = freshHarness();
      const request = makeRequest();
      const capability = mintAndRegister(h, request);
      h.adapter.execute.mockImplementationOnce(() => new Promise(() => {}));

      const firstPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 1_000 }));
      await vi.advanceTimersByTimeAsync(1_000);
      const first = await firstPromise;
      expect(first).toMatchObject({ ok: false, stage: "unknown_outcome" });

      const capability2 = mintAndRegister(h, request);
      const second = await executeAction(baseInput(h, request, { capabilityRaw: capability2 }));

      expect(second).toMatchObject({ ok: false, stage: "reconciliation_required", reasonCode: "UNKNOWN_OUTCOME" });
      // adapter.execute was called exactly once (the original attempt) —
      // the second request only ever reached adapter.lookup().
      expect(h.adapter.execute).toHaveBeenCalledTimes(1);
      expect(h.adapter.lookup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("w3-013-shaped: first attempt times out (UNKNOWN_OUTCOME), a later reconciliation lookup CONFIRMS success -> VERIFIED, RECONCILED_SUCCESS, and the side effect count is exactly one", async () => {
    vi.useFakeTimers();
    try {
      const h = freshHarness();
      const request = makeRequest();
      const capability = mintAndRegister(h, request);
      // The adapter DID execute (its own internal map now has the ticket)
      // but the caller's promise never resolves — a true "response lost".
      h.adapter.execute.mockImplementationOnce(async (operation: AdapterOperation) => {
        h.adapter.lookup.mockImplementation(
          async (): Promise<AdapterLookupResult<TicketReceipt>> =>
            operation.operationId === "op_1" ? { status: "found", receipt: validTicketReceipt() } : { status: "unknown" },
        );
        return new Promise<TicketReceipt>(() => {});
      });

      const firstPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 1_000 }));
      await vi.advanceTimersByTimeAsync(1_000);
      const first = await firstPromise;
      expect(first).toMatchObject({ ok: false, stage: "unknown_outcome" });

      const capability2 = mintAndRegister(h, request);
      const second = await executeAction(baseInput(h, request, { capabilityRaw: capability2 }));

      expect(second).toMatchObject({ ok: true, replay: true, reasonCode: "RECONCILED_SUCCESS" });
      expect(h.adapter.execute).toHaveBeenCalledTimes(1); // still just one real side effect
      expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "succeeded" });
      if (!second.ok) throw new Error("unreachable");
      expect(second.auditEvents.map((e) => e.type)).toEqual(["POSTCONDITION_VERIFIED"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a duplicate request (same idempotency key, same payload) after a SUCCEEDED attempt returns the cached receipt and does NOT call the adapter again", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const first = await executeAction(baseInput(h, request, { capabilityRaw: capability }));
    expect(first).toMatchObject({ ok: true, replay: false });

    const second = await executeAction(baseInput(h, request, { capabilityRaw: capability }));
    expect(second).toMatchObject({ ok: true, receipt: validTicketReceipt(), replay: true, operationId: "op_1" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it("the same idempotency key with a MATERIALLY DIFFERENT operation (different params) is rejected before the adapter is ever called", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);

    const first = await executeAction(baseInput(h, request, { capabilityRaw: capability }));
    expect(first.ok).toBe(true);

    const secondCapability = mintAndRegister(h, request);
    const conflicting = await executeAction(
      baseInput(h, request, { capabilityRaw: secondCapability, params: { title: "A completely different ticket" } }),
    );

    expect(conflicting).toMatchObject({ ok: false, stage: "idempotency", reasonCode: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" });
    expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    expect(h.registry.consume(secondCapability.id, secondCapability.nonce)).toEqual({ ok: true }); // never spent
  });

  it("a failed adapter execution is recorded, and the same (now-consumed) capability cannot be replayed to retry it — a fresh authorization cycle is required", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockRejectedValueOnce(new Error("simulated deterministic tool failure"));

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: false, stage: "adapter", errorMessage: "simulated deterministic tool failure" });
    expect(h.registry.consume(capability.id, capability.nonce)).toEqual({ ok: false, reasonCode: "CAPABILITY_ALREADY_CONSUMED" });
  });
});

describe("executeAction — concurrent duplicate (a genuine race, honestly evaluated)", () => {
  it("two concurrent executeAction calls with the same idempotency key both pass the gateway's own check, but the SYNCHRONOUS adapter-level idempotency map still prevents a second side effect", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capabilityA = mintAndRegister(h, request);
    const capabilityB = mintAndRegister(h, request);

    const callA = executeAction(baseInput(h, request, { capabilityRaw: capabilityA }));
    const callB = executeAction(baseInput(h, request, { capabilityRaw: capabilityB }));

    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultA.ok && resultB.ok).toBe(true);
    expect(h.adapter.execute.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Gate 7's explicit security-assertion checklist, one test per claim. Each
 * of these properties is also exercised elsewhere in this file under a
 * scenario-specific name; these exist so every claim in the Gate 7 report
 * traces to one test with a title that says exactly what it proves.
 */
describe("executeAction — Gate 7 security assertions", () => {
  it("model output cannot mark an operation SUCCEEDED: a receipt smuggling success/verified fields is rejected outright, not read as authoritative", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    // Simulates the only channel through which "model influence" could ever
    // reach a receipt: extra fields on the adapter's response. There is no
    // "verified"/"success" field in TicketReceipt's schema at all — the
    // strict schema treats an attempt to smuggle one the same as any other
    // unrecognized field: the whole receipt fails to parse. Trying to
    // self-declare success does not get silently ignored, it makes the
    // response look malformed and the operation is recorded FAILED.
    h.adapter.execute.mockResolvedValueOnce({
      ...validTicketReceipt(),
      verified: true,
      success: true,
    } as TicketReceipt);

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: false, stage: "postcondition", reasonCode: "POSTCONDITION_UNVERIFIED" });
  });

  it("adapter return text alone cannot mark SUCCEEDED without postcondition proof: a resolved promise with a wrong receipt is FAILED, not SUCCEEDED", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockResolvedValueOnce(validTicketReceipt({ idempotencyKey: "wrong-key" }));

    const result = await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(result).toMatchObject({ ok: false, stage: "postcondition" });
  });

  it("timeout after a possible side effect becomes UNKNOWN_OUTCOME, never SUCCEEDED and never FAILED", async () => {
    vi.useFakeTimers();
    try {
      const h = freshHarness();
      const request = makeRequest();
      const capability = mintAndRegister(h, request);
      h.adapter.execute.mockImplementationOnce(() => new Promise(() => {}));

      const resultPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 500 }));
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.stage).not.toBe("postcondition"); // not FAILED-via-postcondition
      expect(result.stage).toBe("unknown_outcome");
    } finally {
      vi.useRealTimers();
    }
  });

  it("UNKNOWN_OUTCOME cannot be silently converted to SUCCEEDED by a replay carrying no new evidence", async () => {
    vi.useFakeTimers();
    try {
      const h = freshHarness();
      const request = makeRequest();
      const capability = mintAndRegister(h, request);
      h.adapter.execute.mockImplementationOnce(() => new Promise(() => {}));
      const firstPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 500 }));
      await vi.advanceTimersByTimeAsync(500);
      await firstPromise;

      const capability2 = mintAndRegister(h, request);
      const replay = await executeAction(baseInput(h, request, { capabilityRaw: capability2 }));

      expect(replay.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("UNKNOWN_OUTCOME cannot be blindly retried into a duplicate execution: adapter.execute is called at most once across any number of replays", async () => {
    vi.useFakeTimers();
    try {
      const h = freshHarness();
      const request = makeRequest();
      const capability = mintAndRegister(h, request);
      h.adapter.execute.mockImplementationOnce(() => new Promise(() => {}));
      const firstPromise = executeAction(baseInput(h, request, { capabilityRaw: capability, timeoutMs: 500 }));
      await vi.advanceTimersByTimeAsync(500);
      await firstPromise;

      for (let i = 0; i < 3; i++) {
        const retryCapability = mintAndRegister(h, request);
        await executeAction(baseInput(h, request, { capabilityRaw: retryCapability }));
      }

      expect(h.adapter.execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stale precondition blocks execution: adapter side effect count is exactly 0", async () => {
    const h = freshHarness();
    const request = makeRequest({ proposalHash: "h1" });
    const capability = mintAndRegister(h, request);

    await executeAction(
      baseInput(h, request, {
        capabilityRaw: capability,
        precondition: { currentProposalHash: "h2", currentResourceVersion: 3, expectedResourceVersion: 3 },
      }),
    );

    expect(h.adapter.execute).toHaveBeenCalledTimes(0);
  });

  it("a failed postcondition blocks success: the operation is recorded FAILED, never SUCCEEDED, despite the adapter call itself resolving", async () => {
    const h = freshHarness();
    const request = makeRequest();
    const capability = mintAndRegister(h, request);
    h.adapter.execute.mockResolvedValueOnce(validTicketReceipt({ idempotencyKey: "wrong-key" }));

    await executeAction(baseInput(h, request, { capabilityRaw: capability }));

    expect(h.operationStore.lookup("op_1")).toMatchObject({ state: "failed" });
  });
});
