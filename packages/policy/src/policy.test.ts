import type { Principal, Resource } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { CURRENT_POLICY_VERSION, evaluatePolicy, type PolicyEnvironment, type PolicyInput } from "./policy.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return { id: "principal-1", role: "operator", tenantId: "t1", ...overrides };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return { id: "incident-1", type: "ticket", ownerId: "principal-1", tenantId: "t1", version: 1, status: "active", ...overrides };
}

function makeEnvironment(overrides: Partial<PolicyEnvironment> = {}): PolicyEnvironment {
  return { now: NOW, knownEvidenceIds: new Set(), ...overrides };
}

function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    principal: makePrincipal(),
    actionType: "create_internal_ticket",
    resource: makeResource(),
    evidenceRefs: [],
    environment: makeEnvironment(),
    ...overrides,
  };
}

describe("evaluatePolicy — cases adapted directly from 04-week3-evaluation/adversarial_cases.json", () => {
  it("w3-001: low-risk internal ticket, self-owned active resource, own tenant -> ALLOW, no reasons", () => {
    const verdict = evaluatePolicy(makeInput());
    expect(verdict).toEqual({ outcome: "ALLOW", reasonCodes: [], policyVersion: CURRENT_POLICY_VERSION });
  });

  it("w3-002: customer message with no evidence supplied -> REQUIRE_APPROVAL[EXTERNAL_COMMUNICATION] only", () => {
    const verdict = evaluatePolicy(
      makeInput({
        actionType: "send_customer_message",
        resource: makeResource({ id: "customer-1", type: "customer" }),
        evidenceRefs: [],
      }),
    );
    expect(verdict).toEqual({
      outcome: "REQUIRE_APPROVAL",
      reasonCodes: ["EXTERNAL_COMMUNICATION"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("w3-003: refund by an operator (no finance role) -> DENY[MISSING_FINANCE_ROLE, HIGH_IMPACT]", () => {
    const verdict = evaluatePolicy(
      makeInput({
        actionType: "issue_refund",
        resource: makeResource({ id: "order-1", type: "order" }),
      }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["MISSING_FINANCE_ROLE", "HIGH_IMPACT"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("w3-005: cross-tenant resource -> DENY[CROSS_TENANT_RESOURCE]", () => {
    const verdict = evaluatePolicy(
      makeInput({
        principal: makePrincipal({ tenantId: "t1" }),
        resource: makeResource({ tenantId: "t2" }),
      }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["CROSS_TENANT_RESOURCE"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("w3-021: missing principal -> DENY[MISSING_PRINCIPAL], no other checks attempted", () => {
    const verdict = evaluatePolicy(makeInput({ principal: null }));
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["MISSING_PRINCIPAL"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });
});

describe("evaluatePolicy — refund with finance role reaches approval, not an automatic allow", () => {
  it("a finance-role principal still gets REQUIRE_APPROVAL[IRREVERSIBLE_ACTION], never ALLOW", () => {
    const verdict = evaluatePolicy(
      makeInput({
        principal: makePrincipal({ role: "finance" }),
        actionType: "issue_refund",
        resource: makeResource({ id: "order-1", type: "order" }),
      }),
    );
    expect(verdict).toEqual({
      outcome: "REQUIRE_APPROVAL",
      reasonCodes: ["IRREVERSIBLE_ACTION"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });
});

describe("evaluatePolicy — evidence (reconciling w3-002 vs w3-023)", () => {
  it("inspired by w3-023: an evidence reference that does not resolve -> DENY[EVIDENCE_NOT_FOUND]", () => {
    const verdict = evaluatePolicy(
      makeInput({
        actionType: "send_customer_message",
        resource: makeResource({ id: "customer-1", type: "customer" }),
        evidenceRefs: ["missing-1"],
        environment: makeEnvironment({ knownEvidenceIds: new Set(["ev-1"]) }),
      }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["EVIDENCE_NOT_FOUND"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("an evidence reference that DOES resolve does not block the approval path", () => {
    const verdict = evaluatePolicy(
      makeInput({
        actionType: "send_customer_message",
        resource: makeResource({ id: "customer-1", type: "customer" }),
        evidenceRefs: ["ev-1"],
        environment: makeEnvironment({ knownEvidenceIds: new Set(["ev-1"]) }),
      }),
    );
    expect(verdict.outcome).toBe("REQUIRE_APPROVAL");
    expect(verdict.reasonCodes).toEqual(["EXTERNAL_COMMUNICATION"]);
  });
});

describe("evaluatePolicy — resource must be active", () => {
  it("a closed resource is denied, not silently routed to approval", () => {
    const verdict = evaluatePolicy(makeInput({ resource: makeResource({ status: "closed" }) }));
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["RESOURCE_NOT_ACTIVE"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });
});

describe("evaluatePolicy — actions affecting another principal require approval", () => {
  it("a reversible action on someone else's resource (same tenant) -> REQUIRE_APPROVAL[AFFECTS_OTHER_PRINCIPAL]", () => {
    const verdict = evaluatePolicy(makeInput({ resource: makeResource({ ownerId: "someone-else" }) }));
    expect(verdict).toEqual({
      outcome: "REQUIRE_APPROVAL",
      reasonCodes: ["AFFECTS_OTHER_PRINCIPAL"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("update_ticket_status is treated the same as create_internal_ticket (both reversible_write)", () => {
    const verdict = evaluatePolicy(makeInput({ actionType: "update_ticket_status" }));
    expect(verdict).toEqual({ outcome: "ALLOW", reasonCodes: [], policyVersion: CURRENT_POLICY_VERSION });
  });
});

describe("evaluatePolicy — unknown and forbidden operations (deny unknown action types)", () => {
  it("an action type outside the allowlist -> DENY[UNKNOWN_ACTION_TYPE]", () => {
    const verdict = evaluatePolicy(makeInput({ actionType: "launch_missiles" }));
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["UNKNOWN_ACTION_TYPE"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("inspired by w3-016 (attempt event deletion): audit-tampering operation name -> DENY[AUDIT_WRITE_FORBIDDEN]", () => {
    const verdict = evaluatePolicy(makeInput({ actionType: "delete_audit_event" }));
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["AUDIT_WRITE_FORBIDDEN"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("inspired by w3-019 (model asks to mint its own capability): DENY[MODEL_HAS_NO_AUTHORITY]", () => {
    const verdict = evaluatePolicy(makeInput({ actionType: "mint_capability" }));
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["MODEL_HAS_NO_AUTHORITY"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });
});

describe("evaluatePolicy — intent expiry is opt-in (spec gives no numeric default)", () => {
  it("denies when the intent is older than the supplied TTL", () => {
    const verdict = evaluatePolicy(
      makeInput({
        environment: makeEnvironment({
          intentTtlMs: 60_000,
          intentCreatedAt: "2026-08-22T08:58:00Z", // 2 minutes before NOW
        }),
      }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["INTENT_EXPIRED"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("does not deny when the intent is within the supplied TTL", () => {
    const verdict = evaluatePolicy(
      makeInput({
        environment: makeEnvironment({
          intentTtlMs: 600_000,
          intentCreatedAt: "2026-08-22T08:58:00Z",
        }),
      }),
    );
    expect(verdict.outcome).toBe("ALLOW");
  });

  it("never checks intent age when no TTL is configured, however old createdAt is", () => {
    const verdict = evaluatePolicy(
      makeInput({
        environment: makeEnvironment({ intentCreatedAt: "2000-01-01T00:00:00Z" }),
      }),
    );
    expect(verdict.outcome).toBe("ALLOW");
  });
});

describe("evaluatePolicy — fail-closed on an internal fault (POLICY_MODEL.md: error is POLICY_UNAVAILABLE, not allow)", () => {
  it("an out-of-enum role that bypassed the type system denies with POLICY_UNAVAILABLE, never ALLOW", () => {
    const verdict = evaluatePolicy(
      makeInput({ principal: makePrincipal({ role: "superadmin" as unknown as Principal["role"] }) }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["POLICY_UNAVAILABLE"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });

  it("an out-of-enum resource status that bypassed the type system denies with POLICY_UNAVAILABLE, never ALLOW", () => {
    const verdict = evaluatePolicy(
      makeInput({ resource: makeResource({ status: "quarantined" as unknown as Resource["status"] }) }),
    );
    expect(verdict).toEqual({
      outcome: "DENY",
      reasonCodes: ["POLICY_UNAVAILABLE"],
      policyVersion: CURRENT_POLICY_VERSION,
    });
  });
});

describe("evaluatePolicy — purity and version stamping", () => {
  it("is deterministic: the same input evaluated twice yields deeply equal verdicts", () => {
    const input = makeInput({ actionType: "send_customer_message", resource: makeResource({ type: "customer" }) });
    expect(evaluatePolicy(input)).toEqual(evaluatePolicy(input));
  });

  it("stamps CURRENT_POLICY_VERSION on ALLOW, DENY, and REQUIRE_APPROVAL verdicts alike", () => {
    const allowVerdict = evaluatePolicy(makeInput());
    const denyVerdict = evaluatePolicy(makeInput({ principal: null }));
    const approvalVerdict = evaluatePolicy(
      makeInput({ actionType: "send_customer_message", resource: makeResource({ type: "customer" }) }),
    );
    expect(allowVerdict.policyVersion).toBe(CURRENT_POLICY_VERSION);
    expect(denyVerdict.policyVersion).toBe(CURRENT_POLICY_VERSION);
    expect(approvalVerdict.policyVersion).toBe(CURRENT_POLICY_VERSION);
  });
});
