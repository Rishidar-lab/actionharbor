import { z } from "zod";

/**
 * Single source of truth for data shapes crossing package boundaries
 * (DOMAIN_MODEL.md). Gate 0 defined what the capability boundary needs; Gate
 * 1 adds the request-side entities (Principal, Resource, ActionIntent,
 * ActionProposal) and the run state machine. PolicyDecision, Approval,
 * Operation, and AuditEvent are added at the gates that actually use them.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * The complete allowlist of action types ActionHarbor can ever authorize
 * (ACTION_MODEL.md). There is deliberately no `run_shell`, `execute_code`, or
 * open-ended HTTP tool — a capability's `actionType` can only ever be one of
 * these four strings, so a widened action type is a schema failure, not a
 * runtime decision.
 */
export const ActionType = z.enum([
  "create_internal_ticket",
  "send_customer_message",
  "issue_refund",
  "update_ticket_status",
]);
export type ActionType = z.infer<typeof ActionType>;

/**
 * A capability's lifecycle (DOMAIN_MODEL.md `Capability.status`). Only
 * `active` may authorize an adapter call; every other status is a distinct,
 * auditable reason a call was refused.
 */
export const CapabilityStatus = z.enum(["active", "consumed", "revoked", "expired"]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

const isoDatetime = z.string().datetime();

/**
 * `Capability {id, principalId, actionType, resourceId, proposalHash,
 * expiresAt, nonce, status}` (DOMAIN_MODEL.md) — the only runtime authority
 * an adapter call may present. Minted exclusively by the policy/approval
 * pipeline (later gates); never constructed from model output.
 */
export const Capability = z
  .object({
    id: z.string().min(1),
    principalId: z.string().min(1),
    actionType: ActionType,
    resourceId: z.string().min(1),
    proposalHash: z.string().min(1),
    expiresAt: isoDatetime,
    nonce: z.string().min(1),
    status: CapabilityStatus,
  })
  .strict();
export type Capability = z.infer<typeof Capability>;

/**
 * The exact call a capability is being asked to authorize. The gateway
 * compares this, field by field, against the capability it was minted for
 * (ACTION_MODEL.md: "operation, resource, principal, canonical hash ... all
 * match"); a mismatch on any field is a distinct rejection reason, never a
 * generic denial.
 */
export const CapabilityRequest = z
  .object({
    principalId: z.string().min(1),
    actionType: ActionType,
    resourceId: z.string().min(1),
    proposalHash: z.string().min(1),
  })
  .strict();
export type CapabilityRequest = z.infer<typeof CapabilityRequest>;

/**
 * Stable reason codes for a rejected capability check. Every value here is a
 * distinct, testable branch — never a single generic "unauthorized".
 */
export const CapabilityRejectionReason = z.enum([
  "CAPABILITY_STATUS_INVALID",
  "CAPABILITY_EXPIRED",
  "CAPABILITY_SCOPE_MISMATCH",
]);
export type CapabilityRejectionReason = z.infer<typeof CapabilityRejectionReason>;

// ---------------------------------------------------------------------------
// Principal / Resource (DOMAIN_MODEL.md)
// ---------------------------------------------------------------------------

/**
 * Allowlisted principal roles. `finance` is what POLICY_MODEL.md's
 * `MISSING_FINANCE_ROLE` reason code checks for on `issue_refund`; roles are
 * a closed set, never a free-text claim the caller supplies.
 */
export const Role = z.enum(["operator", "finance", "admin"]);
export type Role = z.infer<typeof Role>;

/** `Principal {id, role, tenantId}` — the human or service an action is requested on behalf of. */
export const Principal = z
  .object({
    id: z.string().min(1),
    role: Role,
    tenantId: z.string().min(1),
  })
  .strict();
export type Principal = z.infer<typeof Principal>;

export const ResourceType = z.enum(["ticket", "customer", "order"]);
export type ResourceType = z.infer<typeof ResourceType>;

export const ResourceStatus = z.enum(["active", "closed", "archived"]);
export type ResourceStatus = z.infer<typeof ResourceStatus>;

/**
 * `Resource {id, type, ownerId, version, status}` — the object an action
 * affects. `version` is what makes a resource-changed-after-approval race
 * (THREAT_MODEL.md "Stale approval / TOCTOU") a precondition failure instead
 * of a silent overwrite.
 */
export const Resource = z
  .object({
    id: z.string().min(1),
    type: ResourceType,
    ownerId: z.string().min(1),
    tenantId: z.string().min(1),
    version: z.number().int().nonnegative(),
    status: ResourceStatus,
  })
  .strict();
export type Resource = z.infer<typeof Resource>;

// ---------------------------------------------------------------------------
// ActionIntent / ActionProposal (DOMAIN_MODEL.md)
// ---------------------------------------------------------------------------

/** `ActionIntent {id, runId, principalId, goal, createdAt}` — the user-owned request. */
export const ActionIntent = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    principalId: z.string().min(1),
    goal: z.string().min(1).max(2000),
    createdAt: isoDatetime,
  })
  .strict();
export type ActionIntent = z.infer<typeof ActionIntent>;

/**
 * `ActionProposal {id, intentId, actionType, resourceId, parameters,
 * evidenceRefs, canonicalHash, modelMeta}` — UNTRUSTED until schema
 * validation and policy evaluation succeed (Gate 3 adds the strict,
 * per-action-type `parameters` shape from TOOL_CONTRACTS.md; here
 * `parameters` stays a generic bag because the proposal-level contract
 * doesn't yet know which action type it is validating against).
 * `modelMeta` is opaque, model-authored, and carries no authority — it is
 * evidence to display, never input to a decision.
 */
export const ActionProposal = z
  .object({
    id: z.string().min(1),
    intentId: z.string().min(1),
    actionType: ActionType,
    resourceId: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
    evidenceRefs: z.array(z.string().min(1)),
    canonicalHash: z.string().min(1),
    modelMeta: z.unknown(),
  })
  .strict();
export type ActionProposal = z.infer<typeof ActionProposal>;

// ---------------------------------------------------------------------------
// Run state machine (STATE_MACHINE.md)
// ---------------------------------------------------------------------------

/**
 * Every state a run can be in. Beyond the states in STATE_MACHINE.md's
 * diagram, two are added for reasons documented at their transitions:
 * `REVOKED` (API_SPEC.md `POST /api/actions/{id}/revoke` — "revoked state")
 * and `CONFLICT` (adversarial case w3-024, "two approvals for a single-use
 * action").
 */
export const RunState = z.enum([
  "PROPOSED",
  "VALIDATED",
  "REJECTED",
  "DENIED",
  "APPROVAL_REQUIRED",
  "AUTHORIZED",
  "STALE",
  "EXPIRED",
  "EXECUTING",
  "VERIFIED",
  "FAILED",
  "UNKNOWN_OUTCOME",
  "RECONCILIATION_REQUIRED",
  "REVOKED",
  "CONFLICT",
]);
export type RunState = z.infer<typeof RunState>;

/**
 * Every trigger deterministic code may fire to move a run between states.
 * There is deliberately no "retry" or "regenerate" trigger — a model can
 * request neither (STATE_MACHINE.md: "`UNKNOWN_OUTCOME` is not retryable by
 * model regeneration").
 */
export const RunStateTrigger = z.enum([
  "schema_pass",
  "schema_fail",
  "policy_deny",
  "high_risk",
  "low_risk_policy_allow",
  "matching_approval",
  "ttl_elapsed",
  "fresh_preconditions",
  "plan_or_resource_changed",
  "postcondition_pass",
  "deterministic_tool_failure",
  "timeout_transport_ambiguity",
  "lookup_confirms_success",
  "lookup_confirms_failure",
  "lookup_inconclusive",
  "capability_revoked",
  "concurrent_approval_conflict",
]);
export type RunStateTrigger = z.infer<typeof RunStateTrigger>;

// ---------------------------------------------------------------------------
// Policy (POLICY_MODEL.md)
// ---------------------------------------------------------------------------

/**
 * "It returns `ALLOW`, `REQUIRE_APPROVAL`, or `DENY` with stable reason
 * codes. The model never supplies a policy outcome." (POLICY_MODEL.md)
 */
export const PolicyOutcome = z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]);
export type PolicyOutcome = z.infer<typeof PolicyOutcome>;

/**
 * Every reason code the policy engine can emit, each tied to one named rule
 * in POLICY_MODEL.md or ACTION_MODEL.md. `POLICY_UNAVAILABLE` is special: "a
 * policy engine error is `POLICY_UNAVAILABLE`, not allow" — it is what a
 * crash inside evaluation turns into, never a rule outcome on its own.
 */
export const PolicyReasonCode = z.enum([
  "MISSING_PRINCIPAL",
  "UNKNOWN_ACTION_TYPE",
  "AUDIT_WRITE_FORBIDDEN",
  "MODEL_HAS_NO_AUTHORITY",
  "CROSS_TENANT_RESOURCE",
  "INTENT_EXPIRED",
  "MISSING_FINANCE_ROLE",
  "HIGH_IMPACT",
  "EVIDENCE_NOT_FOUND",
  "RESOURCE_NOT_ACTIVE",
  "EXTERNAL_COMMUNICATION",
  "IRREVERSIBLE_ACTION",
  "AFFECTS_OTHER_PRINCIPAL",
  "POLICY_UNAVAILABLE",
]);
export type PolicyReasonCode = z.infer<typeof PolicyReasonCode>;

// ---------------------------------------------------------------------------
// Raw (untrusted) action proposal (TOOL_CONTRACTS.md, TECHNICAL_SPEC.md)
// ---------------------------------------------------------------------------

/**
 * Why this schema exists separately from `ActionProposal`: `ActionProposal`
 * is the server-assembled, trusted record (has an `id`, an `intentId`, a
 * server-computed `canonicalHash`). `RawActionProposal` is what a model
 * adapter is allowed to hand back — untyped intent, not authority — and it
 * is `.strict()` at every level so an extra key (parameter smuggling,
 * ACTION_MODEL.md / w3-004) is a parse failure, not a silently-ignored
 * field. There is no `update_ticket_status` branch: TOOL_CONTRACTS.md
 * specifies a parameter shape for exactly three of the four allowlisted
 * action types. Rather than invent an unspecified contract, a proposal
 * claiming `update_ticket_status` simply fails to match this union — the
 * same "not yet implemented" outcome a genuinely unknown action type gets.
 */
export const CreateInternalTicketParameters = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
export type CreateInternalTicketParameters = z.infer<typeof CreateInternalTicketParameters>;

export const SendCustomerMessageParameters = z
  .object({
    customerId: z.string().min(1),
    body: z.string().min(1).max(2000),
    channel: z.enum(["email", "sms"]),
  })
  .strict();
export type SendCustomerMessageParameters = z.infer<typeof SendCustomerMessageParameters>;

export const IssueRefundParameters = z
  .object({
    orderId: z.string().min(1),
    amountMinorInteger: z.number().int().positive(),
    currency: z.string().length(3),
    reason: z.string().min(1).max(300),
  })
  .strict();
export type IssueRefundParameters = z.infer<typeof IssueRefundParameters>;

const rawActionEnvelopeFields = {
  resourceId: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).max(20),
};

export const RawCreateInternalTicketAction = z
  .object({
    actionType: z.literal("create_internal_ticket"),
    ...rawActionEnvelopeFields,
    parameters: CreateInternalTicketParameters,
  })
  .strict();

export const RawSendCustomerMessageAction = z
  .object({
    actionType: z.literal("send_customer_message"),
    ...rawActionEnvelopeFields,
    parameters: SendCustomerMessageParameters,
  })
  .strict();

export const RawIssueRefundAction = z
  .object({
    actionType: z.literal("issue_refund"),
    ...rawActionEnvelopeFields,
    parameters: IssueRefundParameters,
  })
  .strict();

/** One untrusted proposed action, discriminated by `actionType`. */
export const RawAction = z.discriminatedUnion("actionType", [
  RawCreateInternalTicketAction,
  RawSendCustomerMessageAction,
  RawIssueRefundAction,
]);
export type RawAction = z.infer<typeof RawAction>;

/**
 * The full untrusted wire shape a model turn returns (TECHNICAL_SPEC.md:
 * "`model-adapter` returns `unknown` proposal bytes"). `actions` is capped
 * at 5 — TECHNICAL_SPEC.md's operational limit "maximum actions per run 5"
 * — enforced directly in the schema rather than by a caller remembering to
 * check array length afterward.
 */
export const RawProposalEnvelope = z
  .object({
    actions: z.array(RawAction).min(1).max(5),
  })
  .strict();
export type RawProposalEnvelope = z.infer<typeof RawProposalEnvelope>;

/**
 * Reasons a raw proposal never became a trusted `ActionProposal`
 * (STATE_MACHINE.md `PROPOSED -> REJECTED: schema_fail`). Distinct from
 * `PolicyReasonCode`: these are schema-layer rejections — TEST_PLAN.md's
 * contracts layer promises "invalid never reaches policy", so a proposal
 * rejected here never produces a `PolicyDecision` at all.
 */
export const ProposalRejectionReason = z.enum([
  "PROPOSAL_TOO_LARGE",
  "MALFORMED_PROPOSAL",
  "UNKNOWN_FIELD",
  "INVALID_AMOUNT",
  "PARAMETER_TOO_LARGE",
  "INVALID_PROPOSAL",
]);
export type ProposalRejectionReason = z.infer<typeof ProposalRejectionReason>;

// ---------------------------------------------------------------------------
// Adapter receipts (TOOL_CONTRACTS.md)
// ---------------------------------------------------------------------------

/**
 * `.strict()` for the same reason `RawAction` is: "Tool outputs are
 * untrusted. They pass strict schemas ... and cannot contain an audit event
 * or policy decision" (TOOL_CONTRACTS.md). A receipt claiming an extra field
 * like `verified` or `policyDecision` (w3-011, "Malicious tool output
 * claims verified") fails to parse rather than being silently accepted.
 */
export const TicketReceipt = z
  .object({
    ticketId: z.string().min(1),
    status: z.literal("open"),
    title: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    priority: z.enum(["low", "medium", "high"]),
    idempotencyKey: z.string().min(1),
    resourceId: z.string().min(1),
    createdAt: isoDatetime,
  })
  .strict();
export type TicketReceipt = z.infer<typeof TicketReceipt>;

export const MessageReceipt = z
  .object({
    messageId: z.string().min(1),
    customerId: z.string().min(1),
    body: z.string().min(1).max(2000),
    channel: z.enum(["email", "sms"]),
    idempotencyKey: z.string().min(1),
    resourceId: z.string().min(1),
    sentAt: isoDatetime,
  })
  .strict();
export type MessageReceipt = z.infer<typeof MessageReceipt>;

export const RefundReceipt = z
  .object({
    refundId: z.string().min(1),
    orderId: z.string().min(1),
    amountMinorInteger: z.number().int().positive(),
    currency: z.string().length(3),
    reason: z.string().min(1).max(300),
    idempotencyKey: z.string().min(1),
    resourceId: z.string().min(1),
    issuedAt: isoDatetime,
  })
  .strict();
export type RefundReceipt = z.infer<typeof RefundReceipt>;

/** Mirrors `ProposalRejectionReason`'s role, but for the tool-output boundary instead of the model-proposal boundary. */
export const ToolOutputRejectionReason = z.enum(["INVALID_TOOL_OUTPUT"]);
export type ToolOutputRejectionReason = z.infer<typeof ToolOutputRejectionReason>;

// ---------------------------------------------------------------------------
// Approval (DOMAIN_MODEL.md, POLICY_MODEL.md)
// ---------------------------------------------------------------------------

/**
 * `Approval {id, proposalHash, approverId, scope, expiresAt, approvedAt}`
 * (DOMAIN_MODEL.md). Two fields beyond that literal list, for the same
 * reason `AUDIT_EVENT_SCHEMA.md` carries more fields than `AuditEvent`'s
 * one-line summary — the terse brace list is illustrative, not exhaustive:
 * `status` (mirrors `Capability.status` from Gate 0 — needed to make
 * single-use enforceable at all) and `policyVersion` (POLICY_MODEL.md: "An
 * approval references the version used; changing policy invalidates
 * pending approvals").
 */
export const ApprovalStatus = z.enum(["active", "consumed", "invalidated"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalScope = z
  .object({
    actionType: ActionType,
    resourceId: z.string().min(1),
  })
  .strict();
export type ApprovalScope = z.infer<typeof ApprovalScope>;

export const Approval = z
  .object({
    id: z.string().min(1),
    proposalHash: z.string().min(1),
    approverId: z.string().min(1),
    scope: ApprovalScope,
    policyVersion: z.string().min(1),
    expiresAt: isoDatetime,
    approvedAt: isoDatetime,
    status: ApprovalStatus,
  })
  .strict();
export type Approval = z.infer<typeof Approval>;

/** The exact call an approval is being asked to authorize — same shape/spirit as `CapabilityRequest`. */
export const ApprovalRequest = z
  .object({
    proposalHash: z.string().min(1),
    actionType: ActionType,
    resourceId: z.string().min(1),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalRejectionReason = z.enum([
  "APPROVAL_STATUS_INVALID",
  "APPROVAL_ALREADY_CONSUMED",
  "APPROVAL_EXPIRED",
  "PLAN_HASH_MISMATCH",
  "APPROVAL_SCOPE_MISMATCH",
]);
export type ApprovalRejectionReason = z.infer<typeof ApprovalRejectionReason>;
