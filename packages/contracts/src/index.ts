import { z } from "zod";

/**
 * Single source of truth for data shapes crossing package boundaries
 * (DOMAIN_MODEL.md). Gate 0 defines only what the capability boundary needs;
 * ActionIntent, ActionProposal, PolicyDecision, Approval, Operation, and
 * AuditEvent are added at the gates that actually use them.
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
