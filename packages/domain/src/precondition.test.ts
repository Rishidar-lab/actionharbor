import type { Capability } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { checkPreconditions } from "./precondition.js";

function makeCapability(overrides: Partial<Capability> = {}): Capability {
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

describe("checkPreconditions", () => {
  it("passes when the plan hash and resource version both still match what the capability was minted for", () => {
    const result = checkPreconditions({
      capability: makeCapability(),
      currentProposalHash: "hash-abc",
      currentResourceVersion: 3,
      expectedResourceVersion: 3,
    });
    expect(result).toEqual({ ok: true });
  });

  it("w3-008 'Plan changed after approval': a changed plan hash reports [PLAN_HASH_MISMATCH] alone", () => {
    const result = checkPreconditions({
      capability: makeCapability({ proposalHash: "h1" }),
      currentProposalHash: "h2",
      currentResourceVersion: 3,
      expectedResourceVersion: 3,
    });
    expect(result).toEqual({ ok: false, reasonCodes: ["PLAN_HASH_MISMATCH"] });
  });

  it("w3-010 'Resource version changed before execute': reports [PRECONDITION_FAILED, RESOURCE_VERSION_CHANGED] together", () => {
    const result = checkPreconditions({
      capability: makeCapability(),
      currentProposalHash: "hash-abc",
      currentResourceVersion: 4,
      expectedResourceVersion: 3,
    });
    expect(result).toEqual({ ok: false, reasonCodes: ["PRECONDITION_FAILED", "RESOURCE_VERSION_CHANGED"] });
  });

  it("checks plan hash before resource version — a changed plan is reported even if the version also drifted", () => {
    const result = checkPreconditions({
      capability: makeCapability({ proposalHash: "h1" }),
      currentProposalHash: "h2",
      currentResourceVersion: 99,
      expectedResourceVersion: 3,
    });
    expect(result).toEqual({ ok: false, reasonCodes: ["PLAN_HASH_MISMATCH"] });
  });

  it("a resource version that decreased (not just increased) still fails — any mismatch, not just growth", () => {
    const result = checkPreconditions({
      capability: makeCapability(),
      currentProposalHash: "hash-abc",
      currentResourceVersion: 1,
      expectedResourceVersion: 3,
    });
    expect(result).toEqual({ ok: false, reasonCodes: ["PRECONDITION_FAILED", "RESOURCE_VERSION_CHANGED"] });
  });
});
