import { describe, expect, it } from "vitest";
import {
  FABRICATED_VERIFICATION_RAW,
  MALFORMED_JSON_RAW,
  NEGATIVE_REFUND_AMOUNT_RAW,
  OVERSIZED_MESSAGE_BODY_RAW,
  OVERSIZED_PROPOSAL_RAW,
  SELF_GRANT_CAPABILITY_RAW,
  TOO_MANY_ACTIONS_RAW,
  UNKNOWN_FIELD_RAW,
} from "./test-support/adversarial-fixtures.js";
import { parseModelProposal } from "./parse-proposal.js";

function validTicketRaw(): string {
  return JSON.stringify({
    actions: [
      {
        actionType: "create_internal_ticket",
        resourceId: "incident-1",
        evidenceRefs: [],
        parameters: { title: "Cold-chain check", priority: "high" },
      },
    ],
  });
}

describe("parseModelProposal — the happy path (w3-001-shaped input)", () => {
  it("parses a single well-formed action", () => {
    const result = parseModelProposal(validTicketRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      actionType: "create_internal_ticket",
      resourceId: "incident-1",
      parameters: { title: "Cold-chain check", priority: "high" },
    });
  });

  it("parses multiple actions in one envelope (DEMO_PLAN.md: a single goal proposing 3 actions)", () => {
    const raw = JSON.stringify({
      actions: [
        {
          actionType: "create_internal_ticket",
          resourceId: "order-1042",
          evidenceRefs: [],
          parameters: { title: "Cold-chain incident for order 1042" },
        },
        {
          actionType: "send_customer_message",
          resourceId: "customer-1042",
          evidenceRefs: [],
          parameters: { customerId: "customer-1042", body: "We found an issue with your order.", channel: "email" },
        },
        {
          actionType: "issue_refund",
          resourceId: "order-1042",
          evidenceRefs: [],
          parameters: { orderId: "order-1042", amountMinorInteger: 2500, currency: "USD", reason: "Cold-chain failure" },
        },
      ],
    });
    const result = parseModelProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.actions).toHaveLength(3);
  });

  it("description and priority are optional on create_internal_ticket", () => {
    const raw = JSON.stringify({
      actions: [
        { actionType: "create_internal_ticket", resourceId: "incident-1", evidenceRefs: [], parameters: { title: "x" } },
      ],
    });
    expect(parseModelProposal(raw).ok).toBe(true);
  });
});

describe("parseModelProposal — malformed and unsafe output remains untrusted (Gate 3 acceptance criterion)", () => {
  it("w3-022: malformed JSON syntax -> MALFORMED_PROPOSAL", () => {
    const result = parseModelProposal(MALFORMED_JSON_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "MALFORMED_PROPOSAL" });
  });

  it("w3-004: unknown field smuggling -> UNKNOWN_FIELD, and the valid title alone does not save it", () => {
    const result = parseModelProposal(UNKNOWN_FIELD_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "UNKNOWN_FIELD" });
  });

  it("w3-014: negative refund amount -> INVALID_AMOUNT", () => {
    const result = parseModelProposal(NEGATIVE_REFUND_AMOUNT_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "INVALID_AMOUNT" });
  });

  it("a zero refund amount is equally invalid (amountMinorInteger must be positive, not just non-negative)", () => {
    const raw = JSON.stringify({
      actions: [
        {
          actionType: "issue_refund",
          resourceId: "order-1",
          evidenceRefs: [],
          parameters: { orderId: "order-1", amountMinorInteger: 0, currency: "INR", reason: "x" },
        },
      ],
    });
    expect(parseModelProposal(raw)).toMatchObject({ ok: false, reasonCode: "INVALID_AMOUNT" });
  });

  it("a non-integer refund amount is equally invalid", () => {
    const raw = JSON.stringify({
      actions: [
        {
          actionType: "issue_refund",
          resourceId: "order-1",
          evidenceRefs: [],
          parameters: { orderId: "order-1", amountMinorInteger: 10.5, currency: "INR", reason: "x" },
        },
      ],
    });
    expect(parseModelProposal(raw)).toMatchObject({ ok: false, reasonCode: "INVALID_AMOUNT" });
  });

  it("w3-015: an oversized message body (2001 chars, over the 2000 limit) -> PARAMETER_TOO_LARGE", () => {
    const result = parseModelProposal(OVERSIZED_MESSAGE_BODY_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "PARAMETER_TOO_LARGE" });
  });

  it("an oversized ticket title (over 120 chars) -> PARAMETER_TOO_LARGE", () => {
    const raw = JSON.stringify({
      actions: [
        { actionType: "create_internal_ticket", resourceId: "incident-1", evidenceRefs: [], parameters: { title: "x".repeat(121) } },
      ],
    });
    expect(parseModelProposal(raw)).toMatchObject({ ok: false, reasonCode: "PARAMETER_TOO_LARGE" });
  });

  it("proposing more than 5 actions in one run violates TECHNICAL_SPEC.md's operational limit and is rejected", () => {
    const result = parseModelProposal(TOO_MANY_ACTIONS_RAW);
    expect(result.ok).toBe(false);
  });

  it("a proposal over the 64 KiB size limit is rejected as PROPOSAL_TOO_LARGE without ever being JSON-parsed", () => {
    const result = parseModelProposal(OVERSIZED_PROPOSAL_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "PROPOSAL_TOO_LARGE" });
  });

  it("inspired by w3-019: a model naming a capability-minting operation as an action cannot even parse as a known action type", () => {
    const result = parseModelProposal(SELF_GRANT_CAPABILITY_RAW);
    expect(result.ok).toBe(false);
  });

  it("inspired by w3-011: a fabricated verified/policyDecision/auditEvent smuggled into parameters is rejected as UNKNOWN_FIELD, never accepted as evidence of anything", () => {
    const result = parseModelProposal(FABRICATED_VERIFICATION_RAW);
    expect(result).toMatchObject({ ok: false, reasonCode: "UNKNOWN_FIELD" });
  });

  it("update_ticket_status is a real ActionType but has no TOOL_CONTRACTS.md parameter shape yet, so it fails to parse rather than being guessed at", () => {
    const raw = JSON.stringify({
      actions: [{ actionType: "update_ticket_status", resourceId: "ticket-1", evidenceRefs: [], parameters: { status: "closed" } }],
    });
    expect(parseModelProposal(raw).ok).toBe(false);
  });

  it("a completely unrecognized action type is rejected the same way an unimplemented one is", () => {
    const raw = JSON.stringify({
      actions: [{ actionType: "launch_missiles", resourceId: "x", evidenceRefs: [], parameters: {} }],
    });
    expect(parseModelProposal(raw).ok).toBe(false);
  });

  it("an empty actions array is rejected (at least one action is required)", () => {
    expect(parseModelProposal(JSON.stringify({ actions: [] })).ok).toBe(false);
  });

  it("a top-level unrecognized field on the envelope itself is rejected", () => {
    const raw = JSON.stringify({
      actions: [
        { actionType: "create_internal_ticket", resourceId: "incident-1", evidenceRefs: [], parameters: { title: "x" } },
      ],
      modelConfidence: 0.99,
    });
    expect(parseModelProposal(raw)).toMatchObject({ ok: false, reasonCode: "UNKNOWN_FIELD" });
  });
});

describe("parseModelProposal — determinism", () => {
  it("the same raw bytes always produce the same result", () => {
    const raw = validTicketRaw();
    expect(parseModelProposal(raw)).toEqual(parseModelProposal(raw));
  });
});
