import type { Approval, ApprovalRequest } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { checkApproval, consumeApproval, selectApprovalTrigger } from "./approval.js";
import { transition } from "./state-machine.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "appr_1",
    proposalHash: "hash-abc",
    approverId: "approver-1",
    scope: { actionType: "send_customer_message", resourceId: "customer-1" },
    policyVersion: "policy-2026-08-22.1",
    expiresAt: "2026-08-22T09:10:00Z",
    approvedAt: "2026-08-22T09:00:00Z",
    status: "active",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    proposalHash: "hash-abc",
    actionType: "send_customer_message",
    resourceId: "customer-1",
    ...overrides,
  };
}

describe("checkApproval", () => {
  it("accepts an active, unexpired, exactly-scoped approval for the matching request", () => {
    expect(checkApproval(makeApproval(), makeRequest(), NOW)).toEqual({ ok: true });
  });

  it("w3-009: an expired approval is rejected — approval_expires_at 09:00:00Z, now 09:01:00Z", () => {
    const result = checkApproval(
      makeApproval({ expiresAt: "2026-08-22T09:00:00Z" }),
      makeRequest(),
      new Date("2026-08-22T09:01:00Z"),
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_EXPIRED" });
  });

  it("treats expiresAt exactly equal to now as expired (no grace window, same rule as Gate 0's capability check)", () => {
    const result = checkApproval(makeApproval({ expiresAt: NOW.toISOString() }), makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_EXPIRED" });
  });

  it("w3-008-inspired: a proposal hash that does not match the approval's is rejected as PLAN_HASH_MISMATCH", () => {
    const result = checkApproval(makeApproval({ proposalHash: "h1" }), makeRequest({ proposalHash: "h2" }), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "PLAN_HASH_MISMATCH" });
  });

  it("rejects a resource-id scope mismatch", () => {
    const result = checkApproval(
      makeApproval({ scope: { actionType: "send_customer_message", resourceId: "customer-1" } }),
      makeRequest({ resourceId: "customer-2" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_SCOPE_MISMATCH" });
  });

  it("rejects an action-type scope mismatch", () => {
    const result = checkApproval(makeApproval(), makeRequest({ actionType: "issue_refund" }), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_SCOPE_MISMATCH" });
  });

  it("w3-024-inspired: a consumed approval is rejected as APPROVAL_ALREADY_CONSUMED, distinct from a generic status error", () => {
    const result = checkApproval(makeApproval({ status: "consumed" }), makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_ALREADY_CONSUMED" });
  });

  it("an explicitly invalidated approval is rejected as APPROVAL_STATUS_INVALID", () => {
    const result = checkApproval(makeApproval({ status: "invalidated" }), makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_STATUS_INVALID" });
  });

  it("a consumed approval reports APPROVAL_ALREADY_CONSUMED even when it is also expired and hash-mismatched", () => {
    const result = checkApproval(
      makeApproval({ status: "consumed", expiresAt: "2000-01-01T00:00:00Z", proposalHash: "wrong" }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_ALREADY_CONSUMED" });
  });
});

describe("consumeApproval — single-use enforcement", () => {
  it("consuming a valid approval marks it consumed without mutating the original object", () => {
    const original = makeApproval();
    const result = consumeApproval(original, makeRequest(), NOW);
    expect(result).toEqual({ ok: true, approval: { ...original, status: "consumed" } });
    expect(original.status).toBe("active"); // unmutated
  });

  it("consuming an already-consumed approval fails — this IS single-use, proven at the object level", () => {
    const original = makeApproval();
    const first = consumeApproval(original, makeRequest(), NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    const second = consumeApproval(first.approval, makeRequest(), NOW);
    expect(second).toEqual({ ok: false, reasonCode: "APPROVAL_ALREADY_CONSUMED" });
  });

  it("consuming an expired approval fails without changing its status", () => {
    const expired = makeApproval({ expiresAt: "2000-01-01T00:00:00Z" });
    const result = consumeApproval(expired, makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "APPROVAL_EXPIRED" });
  });

  it("consuming an approval whose plan hash no longer matches fails without consuming it", () => {
    const approval = makeApproval({ proposalHash: "h1" });
    const result = consumeApproval(approval, makeRequest({ proposalHash: "h2" }), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "PLAN_HASH_MISMATCH" });
  });
});

describe("selectApprovalTrigger", () => {
  it("a valid approval selects matching_approval", () => {
    expect(selectApprovalTrigger({ ok: true })).toBe("matching_approval");
  });

  it("APPROVAL_EXPIRED selects ttl_elapsed", () => {
    expect(selectApprovalTrigger({ ok: false, reasonCode: "APPROVAL_EXPIRED" })).toBe("ttl_elapsed");
  });

  it("APPROVAL_ALREADY_CONSUMED selects concurrent_approval_conflict", () => {
    expect(selectApprovalTrigger({ ok: false, reasonCode: "APPROVAL_ALREADY_CONSUMED" })).toBe("concurrent_approval_conflict");
  });

  it.each(["PLAN_HASH_MISMATCH", "APPROVAL_SCOPE_MISMATCH", "APPROVAL_STATUS_INVALID"] as const)(
    "%s selects no transition at all (null) — the run stays at APPROVAL_REQUIRED, awaiting a correct approval",
    (reasonCode) => {
      expect(selectApprovalTrigger({ ok: false, reasonCode })).toBeNull();
    },
  );
});

describe("integration with Gate 1's state machine: a changed plan or expired approval CANNOT authorize", () => {
  it("every failure reason either selects no transition, or a transition that never reaches AUTHORIZED", () => {
    const failureReasons = [
      "APPROVAL_STATUS_INVALID",
      "APPROVAL_ALREADY_CONSUMED",
      "APPROVAL_EXPIRED",
      "PLAN_HASH_MISMATCH",
      "APPROVAL_SCOPE_MISMATCH",
    ] as const;

    for (const reasonCode of failureReasons) {
      const trigger = selectApprovalTrigger({ ok: false, reasonCode });
      if (trigger === null) {
        continue; // no transition attempted -> cannot possibly reach AUTHORIZED
      }
      const result = transition("APPROVAL_REQUIRED", trigger);
      if (result.ok) {
        expect(result.nextState).not.toBe("AUTHORIZED");
      }
    }
  });

  it("only a genuinely valid approval's trigger (matching_approval) reaches AUTHORIZED", () => {
    const trigger = selectApprovalTrigger({ ok: true });
    const result = transition("APPROVAL_REQUIRED", trigger!);
    expect(result).toEqual({ ok: true, nextState: "AUTHORIZED" });
  });
});
