import { describe, expect, it } from "vitest";
import { FakeModelAdapter } from "./fake-model-adapter.js";
import { parseModelProposal } from "./parse-proposal.js";

describe("FakeModelAdapter", () => {
  it("requires no configuration, key, or network — constructible with zero arguments", () => {
    expect(new FakeModelAdapter()).toBeInstanceOf(FakeModelAdapter);
  });

  it("is deterministic: the same goal produces byte-identical raw output", async () => {
    const adapter = new FakeModelAdapter();
    const a = await adapter.propose({ goal: "Resolve order 1042: create an internal incident", resourceId: "order-1042" });
    const b = await adapter.propose({ goal: "Resolve order 1042: create an internal incident", resourceId: "order-1042" });
    expect(a.raw).toBe(b.raw);
  });

  it("every response is still just untrusted bytes, not a pre-validated proposal", async () => {
    const adapter = new FakeModelAdapter();
    const response = await adapter.propose({ goal: "open a ticket", resourceId: "incident-1" });
    expect(typeof response.raw).toBe("string");
  });

  it("a goal mentioning a ticket/incident proposes create_internal_ticket, and it parses as a valid raw action", async () => {
    const adapter = new FakeModelAdapter();
    const response = await adapter.propose({ goal: "open an incident ticket for the cold-chain failure", resourceId: "incident-1" });
    const parsed = parseModelProposal(response.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.actions.some((a) => a.actionType === "create_internal_ticket")).toBe(true);
  });

  it("a goal combining ticket + message + refund (DEMO_PLAN.md's script) proposes all three, all schema-valid", async () => {
    const adapter = new FakeModelAdapter();
    const response = await adapter.propose({
      goal: "Resolve order 1042: create an internal incident, message the customer, and issue a refund",
      resourceId: "order-1042",
    });
    const parsed = parseModelProposal(response.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const actionTypes = parsed.actions.map((a) => a.actionType);
    expect(new Set(actionTypes)).toEqual(new Set(["create_internal_ticket", "send_customer_message", "issue_refund"]));
  });

  it("a goal with no recognized keyword still proposes a schema-valid fallback action, never an empty envelope", async () => {
    const adapter = new FakeModelAdapter();
    const response = await adapter.propose({ goal: "do the thing", resourceId: "resource-1" });
    const parsed = parseModelProposal(response.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.actions.length).toBeGreaterThan(0);
  });

  it("a very long goal is truncated to fit each field's bound rather than producing an oversized (and therefore rejected) parameter", async () => {
    const adapter = new FakeModelAdapter();
    const longGoal = `open a ticket ${"x".repeat(500)}`;
    const response = await adapter.propose({ goal: longGoal, resourceId: "incident-1" });
    const parsed = parseModelProposal(response.raw);
    expect(parsed.ok).toBe(true);
  });
});
