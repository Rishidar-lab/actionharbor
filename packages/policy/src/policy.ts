import type {
  ActionType,
  PolicyOutcome,
  PolicyReasonCode,
  Principal,
  Resource,
  ResourceStatus,
  Role,
} from "@actionharbor/contracts";
import { ActionType as ActionTypeSchema, ResourceStatus as ResourceStatusSchema, Role as RoleSchema } from "@actionharbor/contracts";

/**
 * Immutable per POLICY_MODEL.md: "Policy versions are immutable... changing
 * policy invalidates pending approvals and requires re-evaluation." This
 * constant IS the version — there is exactly one ruleset live at a time, so
 * the PDP stamps it onto every verdict rather than accepting a caller-chosen
 * version as a decision input.
 */
export const CURRENT_POLICY_VERSION = "policy-2026-08-22.1";

/**
 * Operation names that are never business actions, only attempts to reach
 * into the audit ledger (THREAT_MODEL.md "Audit tampering"). Recognized and
 * denied by name even though they are not on the `ActionType` allowlist, so
 * the demo can show a specific, legible reason instead of a generic
 * "unknown action type".
 */
const AUDIT_TAMPERING_OPERATIONS: ReadonlySet<string> = new Set([
  "delete_audit_event",
  "alter_audit_event",
  "rewrite_audit_event",
]);

/**
 * Operation names that ask the system to hand the caller authority it must
 * never hold (THREAT_MODEL.md "Privilege escalation": "Agent asks for
 * capability minting"). SECURITY_MODEL.md: "The model never supplies a
 * policy outcome" — this is that rule made checkable.
 */
const CAPABILITY_SELF_GRANT_OPERATIONS: ReadonlySet<string> = new Set([
  "mint_capability",
  "grant_capability",
  "approve_action",
  "self_approve",
  "set_policy_decision",
]);

/**
 * Action types whose effect a compensating action cannot fully undo
 * (ACTION_MODEL.md `effectClass: irreversible_write`) — `create_internal_ticket`
 * and `update_ticket_status` are reversible; a sent message or an issued
 * refund is not.
 */
const IRREVERSIBLE_ACTION_TYPES: ReadonlySet<ActionType> = new Set(["send_customer_message", "issue_refund"]);

/**
 * Action types checked for a dangling evidence reference
 * (POLICY_MODEL.md: "missing evidence for customer-impacting actions").
 */
const CUSTOMER_IMPACTING_ACTION_TYPES: ReadonlySet<ActionType> = new Set(["send_customer_message", "issue_refund"]);

export interface PolicyEnvironment {
  readonly now: Date;
  /** Evidence ids known to actually exist; an evidenceRef outside this set is a dangling reference. */
  readonly knownEvidenceIds: ReadonlySet<string>;
  /**
   * Optional intent-staleness rule (POLICY_MODEL.md: "deny ... expired
   * intents"). The frozen spec gives no numeric default, so this is off
   * unless a caller explicitly supplies both fields — inventing an
   * unspecified constant would be a silent, untestable business decision.
   */
  readonly intentTtlMs?: number;
  readonly intentCreatedAt?: string;
}

export interface PolicyInput {
  readonly principal: Principal | null;
  /**
   * Deliberately wider than `ActionType`: this lets the PDP recognize and
   * deny a forbidden or unrecognized operation name by itself (audit
   * tampering, capability self-grant, or simply unknown) instead of relying
   * on a schema layer to have already excluded it.
   */
  readonly actionType: string;
  readonly resource: Resource;
  readonly evidenceRefs: readonly string[];
  readonly environment: PolicyEnvironment;
}

export interface PolicyVerdict {
  readonly outcome: PolicyOutcome;
  readonly reasonCodes: readonly PolicyReasonCode[];
  readonly policyVersion: string;
}

function deny(reasonCodes: PolicyReasonCode[]): PolicyVerdict {
  return { outcome: "DENY", reasonCodes, policyVersion: CURRENT_POLICY_VERSION };
}

function requireApproval(reasonCodes: PolicyReasonCode[]): PolicyVerdict {
  return { outcome: "REQUIRE_APPROVAL", reasonCodes, policyVersion: CURRENT_POLICY_VERSION };
}

function allow(): PolicyVerdict {
  return { outcome: "ALLOW", reasonCodes: [], policyVersion: CURRENT_POLICY_VERSION };
}

/** Defensive: a value that reached policy with a role outside the allowlist is an internal fault, not a rule outcome. */
function assertValidRole(role: string): asserts role is Role {
  if (!RoleSchema.options.includes(role as Role)) {
    throw new Error(`policy: principal role "${role}" is not a recognized role`);
  }
}

/** Defensive: same reasoning as assertValidRole, for resource status. */
function assertValidResourceStatus(status: string): asserts status is ResourceStatus {
  if (!ResourceStatusSchema.options.includes(status as ResourceStatus)) {
    throw new Error(`policy: resource status "${status}" is not a recognized status`);
  }
}

/**
 * The evaluation logic, allowed to throw. Never call this directly — always
 * go through `evaluatePolicy`, which is what turns a thrown error into the
 * fail-closed `POLICY_UNAVAILABLE` verdict POLICY_MODEL.md requires: "A deny
 * is fail-closed; a policy engine error is `POLICY_UNAVAILABLE`, not allow."
 *
 * Checks run in a fixed, documented order because several are guard clauses
 * that make later checks meaningless (no principal -> no role to check; no
 * recognized action type -> no action-specific rule applies). Two examples
 * from `04-week3-evaluation/adversarial_cases.json` fix the boundary between
 * "deny" and "approve" precisely where the prose alone was ambiguous:
 *
 * - w3-003 (refund, no finance role) expects DENY with reason codes
 *   `[MISSING_FINANCE_ROLE, HIGH_IMPACT]` together — modeled here as one
 *   compound rule, not two independently-firing ones, because a
 *   finance-role holder must still reach REQUIRE_APPROVAL for the same
 *   action (ACTION_MODEL.md: "always denied ... unless a human with finance
 *   role approves"), so `HIGH_IMPACT` cannot be a standalone rule that fires
 *   regardless of role.
 * - w3-002 (customer message, no evidence_refs at all) expects
 *   REQUIRE_APPROVAL with reason `[EXTERNAL_COMMUNICATION]` only — not
 *   `EVIDENCE_NOT_FOUND`. Reconciled with w3-023 (customer message with an
 *   evidence ref that does not resolve, which IS denied
 *   `EVIDENCE_NOT_FOUND`) by scoping the evidence rule to dangling
 *   references only: supplying zero evidence is not itself a denial here,
 *   only citing evidence that cannot be found is.
 */
function evaluateUnsafe(input: PolicyInput): PolicyVerdict {
  if (input.principal === null) {
    return deny(["MISSING_PRINCIPAL"]);
  }
  const principal = input.principal;
  assertValidRole(principal.role);

  if (AUDIT_TAMPERING_OPERATIONS.has(input.actionType)) {
    return deny(["AUDIT_WRITE_FORBIDDEN"]);
  }
  if (CAPABILITY_SELF_GRANT_OPERATIONS.has(input.actionType)) {
    return deny(["MODEL_HAS_NO_AUTHORITY"]);
  }

  const parsedActionType = ActionTypeSchema.safeParse(input.actionType);
  if (!parsedActionType.success) {
    return deny(["UNKNOWN_ACTION_TYPE"]);
  }
  const actionType = parsedActionType.data;

  assertValidResourceStatus(input.resource.status);

  if (principal.tenantId !== input.resource.tenantId) {
    return deny(["CROSS_TENANT_RESOURCE"]);
  }

  if (input.environment.intentTtlMs !== undefined && input.environment.intentCreatedAt !== undefined) {
    const createdAtMs = new Date(input.environment.intentCreatedAt).getTime();
    const ageMs = input.environment.now.getTime() - createdAtMs;
    if (ageMs > input.environment.intentTtlMs) {
      return deny(["INTENT_EXPIRED"]);
    }
  }

  if (actionType === "issue_refund" && principal.role !== "finance") {
    return deny(["MISSING_FINANCE_ROLE", "HIGH_IMPACT"]);
  }

  if (CUSTOMER_IMPACTING_ACTION_TYPES.has(actionType)) {
    const danglingRef = input.evidenceRefs.find((ref) => !input.environment.knownEvidenceIds.has(ref));
    if (danglingRef !== undefined) {
      return deny(["EVIDENCE_NOT_FOUND"]);
    }
  }

  if (input.resource.status !== "active") {
    return deny(["RESOURCE_NOT_ACTIVE"]);
  }

  // No deny rule fired past this point — decide between REQUIRE_APPROVAL and ALLOW.

  if (actionType === "send_customer_message") {
    return requireApproval(["EXTERNAL_COMMUNICATION"]);
  }

  if (IRREVERSIBLE_ACTION_TYPES.has(actionType)) {
    // Only issue_refund reaches here (send_customer_message already returned
    // above), and only once principal.role === "finance" — the alternative
    // was excluded by the MISSING_FINANCE_ROLE rule.
    return requireApproval(["IRREVERSIBLE_ACTION"]);
  }

  if (input.resource.ownerId !== principal.id) {
    return requireApproval(["AFFECTS_OTHER_PRINCIPAL"]);
  }

  // create_internal_ticket / update_ticket_status on an active, same-tenant,
  // self-owned resource (POLICY_MODEL.md: "Allow low-risk internal ticket
  // creation only when the principal owns the workspace and the resource is
  // active" — extended to update_ticket_status, which is equally reversible
  // and resource-version-protected per ACTION_MODEL.md, and which no
  // evaluation case pins to a different outcome).
  return allow();
}

/**
 * The policy decision point (PDP). Pure: same input, same instant, same
 * verdict, always — no I/O, no adapter calls, no reading the system clock
 * itself (the caller supplies `environment.now`). The model never supplies
 * a policy outcome; this is the only function in the codebase allowed to
 * produce one.
 */
export function evaluatePolicy(input: PolicyInput): PolicyVerdict {
  try {
    return evaluateUnsafe(input);
  } catch {
    return deny(["POLICY_UNAVAILABLE"]);
  }
}
