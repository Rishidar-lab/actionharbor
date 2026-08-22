import type { Approval, CapabilityRequest } from "@actionharbor/contracts";
import { computeProposalHash, consumeApproval, CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { CapabilityRegistry, executeAction, mintCapability, OperationStore } from "@actionharbor/gateway";
import { FakeModelAdapter, parseModelProposal } from "@actionharbor/model-adapter";
import { evaluatePolicy } from "@actionharbor/policy";
import { describe, expect, it } from "vitest";
import { FakeMessageAdapter } from "./message-adapter.js";
import { FakeRefundAdapter } from "./refund-adapter.js";
import { FakeTicketAdapter } from "./ticket-adapter.js";

/**
 * End-to-end proof, starting from literal untrusted raw bytes: FakeModelAdapter
 * -> parseModelProposal -> evaluatePolicy -> (mint | approve-then-mint) ->
 * CapabilityRegistry -> executeAction -> the REAL FakeTicketAdapter/
 * FakeMessageAdapter/FakeRefundAdapter (not a spy — the actual production
 * side-effect boundary). This is the whole thesis in one file: "AI intent
 * is not authority to act."
 */

const NOW = new Date("2026-08-22T09:00:00Z");
const SCHEMA_VERSION = "w3-proposal-1";

describe("full chain — ALLOW path: model intent becomes exactly one real ticket", () => {
  it("create_internal_ticket goes model -> policy ALLOW -> mint -> execute against the real FakeTicketAdapter", async () => {
    const model = new FakeModelAdapter();
    const { raw } = await model.propose({ goal: "open an incident ticket for the cold-chain failure", resourceId: "incident-1" });

    const parsed = parseModelProposal(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const action = parsed.actions.find((a) => a.actionType === "create_internal_ticket");
    expect(action).toBeDefined();
    if (action === undefined || action.actionType !== "create_internal_ticket") throw new Error("unreachable");

    const verdict = evaluatePolicy({
      principal: { id: "principal-1", role: "operator", tenantId: "t1" },
      actionType: action.actionType,
      resource: { id: action.resourceId, type: "ticket", ownerId: "principal-1", tenantId: "t1", version: 1, status: "active" },
      evidenceRefs: action.evidenceRefs,
      environment: { now: NOW, knownEvidenceIds: new Set() },
    });
    expect(verdict.outcome).toBe("ALLOW");

    const proposalHash = computeProposalHash({
      schemaVersion: SCHEMA_VERSION,
      actionType: action.actionType,
      resourceId: action.resourceId,
      parameters: action.parameters,
      evidenceRefs: action.evidenceRefs,
    });
    const request: CapabilityRequest = {
      principalId: "principal-1",
      actionType: action.actionType,
      resourceId: action.resourceId,
      proposalHash,
    };

    const idGenerator = new CounterIdGenerator();
    const clock = new FixedClock(NOW);
    const mintResult = mintCapability({ kind: "policy-allow", verdict }, request, idGenerator, clock, 60_000);
    expect(mintResult.ok).toBe(true);
    if (!mintResult.ok) throw new Error("unreachable");

    const registry = new CapabilityRegistry();
    registry.record(mintResult.capability);
    const operationStore = new OperationStore<Awaited<ReturnType<FakeTicketAdapter["execute"]>>>();
    const adapter = new FakeTicketAdapter(idGenerator, clock);

    const result = await executeAction({
      capabilityRaw: mintResult.capability,
      request,
      registry,
      operationStore,
      adapter,
      operation: { operationId: "op_1", idempotencyKey: "key-1" },
      params: action.parameters,
      clock,
      precondition: { currentProposalHash: proposalHash, currentResourceVersion: 1, expectedResourceVersion: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.receipt.status).toBe("open");

    // Proof from the adapter's OWN state, not from executeAction's report of success.
    const lookedUp = await adapter.lookup("op_1");
    expect(lookedUp).toEqual({ status: "found", receipt: result.receipt });
  });
});

describe("full chain — REQUIRE_APPROVAL path: model intent becomes exactly one real message, only after a human approves the exact hash", () => {
  it("send_customer_message goes model -> policy REQUIRE_APPROVAL -> human approves -> mint -> execute against the real FakeMessageAdapter", async () => {
    const model = new FakeModelAdapter();
    const { raw } = await model.propose({ goal: "send the customer a message about the delay", resourceId: "customer-1" });

    const parsed = parseModelProposal(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const action = parsed.actions.find((a) => a.actionType === "send_customer_message");
    expect(action).toBeDefined();
    if (action === undefined || action.actionType !== "send_customer_message") throw new Error("unreachable");

    const verdict = evaluatePolicy({
      principal: { id: "principal-1", role: "operator", tenantId: "t1" },
      actionType: action.actionType,
      resource: { id: action.resourceId, type: "customer", ownerId: "principal-1", tenantId: "t1", version: 1, status: "active" },
      evidenceRefs: action.evidenceRefs,
      environment: { now: NOW, knownEvidenceIds: new Set() },
    });
    expect(verdict.outcome).toBe("REQUIRE_APPROVAL");

    const proposalHash = computeProposalHash({
      schemaVersion: SCHEMA_VERSION,
      actionType: action.actionType,
      resourceId: action.resourceId,
      parameters: action.parameters,
      evidenceRefs: action.evidenceRefs,
    });
    const request: CapabilityRequest = {
      principalId: "principal-1",
      actionType: action.actionType,
      resourceId: action.resourceId,
      proposalHash,
    };

    // A human approves the EXACT hash (UX_SPEC.md: "the exact action type,
    // resource, parameters, ... plan hash").
    const approval: Approval = {
      id: "appr_1",
      proposalHash,
      approverId: "human-approver-1",
      scope: { actionType: action.actionType, resourceId: action.resourceId },
      policyVersion: verdict.policyVersion,
      expiresAt: "2026-08-22T09:10:00Z",
      approvedAt: NOW.toISOString(),
      status: "active",
    };
    const consumed = consumeApproval(approval, { proposalHash, actionType: action.actionType, resourceId: action.resourceId }, NOW);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) throw new Error("unreachable");

    const idGenerator = new CounterIdGenerator();
    const clock = new FixedClock(NOW);
    const mintResult = mintCapability({ kind: "approved", approval: consumed.approval }, request, idGenerator, clock, 60_000);
    expect(mintResult.ok).toBe(true);
    if (!mintResult.ok) throw new Error("unreachable");

    const registry = new CapabilityRegistry();
    registry.record(mintResult.capability);
    const operationStore = new OperationStore<Awaited<ReturnType<FakeMessageAdapter["execute"]>>>();
    const adapter = new FakeMessageAdapter(idGenerator, clock);

    const result = await executeAction({
      capabilityRaw: mintResult.capability,
      request,
      registry,
      operationStore,
      adapter,
      operation: { operationId: "op_1", idempotencyKey: "key-1" },
      params: action.parameters,
      clock,
      precondition: { currentProposalHash: proposalHash, currentResourceVersion: 1, expectedResourceVersion: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const lookedUp = await adapter.lookup("op_1");
    expect(lookedUp).toEqual({ status: "found", receipt: result.receipt });
  });
});

describe("full chain — DENY path: a refund without finance role never produces a capability, so the adapter is never even reachable", () => {
  it("issue_refund by an operator (no finance role) is denied before any capability could exist", async () => {
    const model = new FakeModelAdapter();
    const { raw } = await model.propose({ goal: "issue a refund for the damaged order", resourceId: "order-1" });

    const parsed = parseModelProposal(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const action = parsed.actions.find((a) => a.actionType === "issue_refund");
    expect(action).toBeDefined();
    if (action === undefined || action.actionType !== "issue_refund") throw new Error("unreachable");

    const verdict = evaluatePolicy({
      principal: { id: "principal-1", role: "operator", tenantId: "t1" },
      actionType: action.actionType,
      resource: { id: action.resourceId, type: "order", ownerId: "principal-1", tenantId: "t1", version: 1, status: "active" },
      evidenceRefs: action.evidenceRefs,
      environment: { now: NOW, knownEvidenceIds: new Set() },
    });
    expect(verdict).toMatchObject({ outcome: "DENY", reasonCodes: ["MISSING_FINANCE_ROLE", "HIGH_IMPACT"] });

    // There is no legitimate way to obtain a capability from here — DENY is
    // not one of mintCapability's two accepted evidence shapes. Confirmed
    // directly: attempting to mint from this verdict fails.
    const proposalHash = computeProposalHash({
      schemaVersion: SCHEMA_VERSION,
      actionType: action.actionType,
      resourceId: action.resourceId,
      parameters: action.parameters,
      evidenceRefs: action.evidenceRefs,
    });
    const mintResult = mintCapability(
      { kind: "policy-allow", verdict },
      { principalId: "principal-1", actionType: action.actionType, resourceId: action.resourceId, proposalHash },
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(mintResult).toEqual({ ok: false, reasonCode: "POLICY_DID_NOT_ALLOW" });

    // No capability was ever minted, so the refund adapter — the
    // highest-stakes one — never records a single refund.
    const adapter = new FakeRefundAdapter(new CounterIdGenerator(), new FixedClock(NOW));
    expect(await adapter.lookup("op_1")).toEqual({ status: "unknown" });
  });
});
