import type { Approval, CapabilityRequest } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import type { PolicyVerdict } from "@actionharbor/policy";
import { describe, expect, it } from "vitest";
import { MAX_CAPABILITY_TTL_MS, mintCapability } from "./mint-capability.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    ...overrides,
  };
}

function makeAllowVerdict(overrides: Partial<PolicyVerdict> = {}): PolicyVerdict {
  return { outcome: "ALLOW", reasonCodes: [], policyVersion: "policy-2026-08-22.1", ...overrides };
}

function makeConsumedApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "appr_1",
    proposalHash: "hash-abc",
    approverId: "approver-1",
    scope: { actionType: "create_internal_ticket", resourceId: "incident-1" },
    policyVersion: "policy-2026-08-22.1",
    expiresAt: "2026-08-22T09:10:00Z",
    approvedAt: "2026-08-22T09:00:00Z",
    status: "consumed",
    ...overrides,
  };
}

describe("mintCapability — policy-allow evidence", () => {
  it("mints a capability scoped exactly to the request when the verdict is ALLOW", () => {
    const result = mintCapability(
      { kind: "policy-allow", verdict: makeAllowVerdict() },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.capability).toMatchObject({
      principalId: "principal-1",
      actionType: "create_internal_ticket",
      resourceId: "incident-1",
      proposalHash: "hash-abc",
      status: "active",
    });
  });

  it("w3-003-adjacent (test #7): refuses to mint from a DENY verdict", () => {
    const result = mintCapability(
      { kind: "policy-allow", verdict: makeAllowVerdict({ outcome: "DENY", reasonCodes: ["MISSING_FINANCE_ROLE", "HIGH_IMPACT"] }) },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "POLICY_DID_NOT_ALLOW" });
  });

  it("refuses to mint from a REQUIRE_APPROVAL verdict — that path must go through the approved-evidence branch instead", () => {
    const result = mintCapability(
      { kind: "policy-allow", verdict: makeAllowVerdict({ outcome: "REQUIRE_APPROVAL", reasonCodes: ["EXTERNAL_COMMUNICATION"] }) },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "POLICY_DID_NOT_ALLOW" });
  });
});

describe("mintCapability — approved evidence", () => {
  it("mints a capability from a properly consumed, matching approval", () => {
    const result = mintCapability(
      { kind: "approved", approval: makeConsumedApproval() },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result.ok).toBe(true);
  });

  it("test #8 'required approval missing': an approval that is merely active (not consumed) cannot mint", () => {
    const result = mintCapability(
      { kind: "approved", approval: makeConsumedApproval({ status: "active" }) },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_NOT_CONSUMED" });
  });

  it("an approval marked invalidated cannot mint either", () => {
    const result = mintCapability(
      { kind: "approved", approval: makeConsumedApproval({ status: "invalidated" }) },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_NOT_CONSUMED" });
  });

  it("test #10 'changed plan after approval': a consumed approval whose hash no longer matches the request cannot mint", () => {
    const result = mintCapability(
      { kind: "approved", approval: makeConsumedApproval({ proposalHash: "h1" }) },
      makeRequest({ proposalHash: "h2" }),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "PLAN_HASH_MISMATCH" });
  });

  it("a consumed approval scoped to a different resource cannot mint for this request", () => {
    const result = mintCapability(
      { kind: "approved", approval: makeConsumedApproval({ scope: { actionType: "create_internal_ticket", resourceId: "other" } }) },
      makeRequest({ resourceId: "incident-1" }),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_SCOPE_MISMATCH" });
  });
});

describe("mintCapability — TTL enforcement", () => {
  it("TECHNICAL_SPEC.md 'capability TTL ≤5 minutes': a requested TTL beyond the max is clamped down, never honored as-is", () => {
    const result = mintCapability(
      { kind: "policy-allow", verdict: makeAllowVerdict() },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      10 * 60 * 1000, // 10 minutes requested
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const expiresAtMs = new Date(result.capability.expiresAt).getTime();
    expect(expiresAtMs - NOW.getTime()).toBe(MAX_CAPABILITY_TTL_MS);
  });

  it("a TTL within the max is honored exactly", () => {
    const result = mintCapability(
      { kind: "policy-allow", verdict: makeAllowVerdict() },
      makeRequest(),
      new CounterIdGenerator(),
      new FixedClock(NOW),
      60_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const expiresAtMs = new Date(result.capability.expiresAt).getTime();
    expect(expiresAtMs - NOW.getTime()).toBe(60_000);
  });
});

describe("mintCapability — every minted capability has a fresh, unguessable nonce", () => {
  it("two mints for the same request produce different nonces and different ids", () => {
    const idGenerator = new CounterIdGenerator();
    const a = mintCapability({ kind: "policy-allow", verdict: makeAllowVerdict() }, makeRequest(), idGenerator, new FixedClock(NOW), 60_000);
    const b = mintCapability({ kind: "policy-allow", verdict: makeAllowVerdict() }, makeRequest(), idGenerator, new FixedClock(NOW), 60_000);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.capability.id).not.toBe(b.capability.id);
    expect(a.capability.nonce).not.toBe(b.capability.nonce);
  });
});
