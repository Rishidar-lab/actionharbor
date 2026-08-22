import type { ActionType, MessageReceipt, RefundReceipt, TicketReceipt, ToolOutputRejectionReason } from "@actionharbor/contracts";
import { MessageReceipt as MessageReceiptSchema, RefundReceipt as RefundReceiptSchema, TicketReceipt as TicketReceiptSchema } from "@actionharbor/contracts";

export type ReceiptValidationResult<TReceipt> =
  | { readonly ok: true; readonly receipt: TReceipt }
  | { readonly ok: false; readonly reasonCode: ToolOutputRejectionReason; readonly details: string };

/**
 * The tool-output mirror of `parseModelProposal` (Gate 3): the only function
 * allowed to say a piece of raw adapter output is trustworthy. Directly
 * implements w3-011 "Malicious tool output claims verified" — a receipt
 * carrying an extra `verified`/`policyDecision`/`auditEvent` field fails to
 * parse against the `.strict()` schema and is rejected as
 * `INVALID_TOOL_OUTPUT`, exactly like TOOL_CONTRACTS.md requires: "Tool
 * outputs are untrusted ... and cannot contain an audit event or policy
 * decision."
 */
export function validateAdapterReceipt(
  actionType: ActionType,
  raw: unknown,
): ReceiptValidationResult<TicketReceipt | MessageReceipt | RefundReceipt> {
  switch (actionType) {
    case "create_internal_ticket":
      return finish(TicketReceiptSchema.safeParse(raw));
    case "send_customer_message":
      return finish(MessageReceiptSchema.safeParse(raw));
    case "issue_refund":
      return finish(RefundReceiptSchema.safeParse(raw));
    case "update_ticket_status":
      return { ok: false, reasonCode: "INVALID_TOOL_OUTPUT", details: "update_ticket_status has no implemented tool contract yet" };
  }
}

function finish<T>(
  result: { success: true; data: T } | { success: false; error: { message: string } },
): ReceiptValidationResult<T> {
  if (!result.success) {
    return { ok: false, reasonCode: "INVALID_TOOL_OUTPUT", details: result.error.message };
  }
  return { ok: true, receipt: result.data };
}
