import type { ActionType, MessageReceipt, RefundReceipt, TicketReceipt } from "@actionharbor/contracts";
import { MessageReceipt as MessageReceiptSchema, RefundReceipt as RefundReceiptSchema, TicketReceipt as TicketReceiptSchema } from "@actionharbor/contracts";

export type PostconditionResult = { readonly ok: true } | { readonly ok: false; readonly reasonCode: "POSTCONDITION_UNVERIFIED" };

const UNVERIFIED: PostconditionResult = { ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" };
const VERIFIED: PostconditionResult = { ok: true };

/**
 * TOOL_CONTRACTS.md: "postcondition is a new ticket with matching
 * idempotency key and status `open`." A malformed receipt (w3-020: an
 * empty `{}`) fails the schema check first and is folded into the same
 * `POSTCONDITION_UNVERIFIED` result — "the adapter's response doesn't
 * prove the claimed side effect" covers both "the response is nonsense"
 * and "the response is well-formed but wrong," deliberately not
 * distinguished here (both mean: do not call this VERIFIED).
 */
export function verifyTicketPostcondition(raw: unknown, expected: { readonly idempotencyKey: string }): PostconditionResult {
  const parsed = TicketReceiptSchema.safeParse(raw);
  if (!parsed.success) return UNVERIFIED;
  const receipt: TicketReceipt = parsed.data;
  // `status: "open"` is already guaranteed by TicketReceipt's schema
  // (a z.literal — no other value can parse), so the only thing left to
  // check is that this receipt is actually the one for THIS call.
  if (receipt.idempotencyKey !== expected.idempotencyKey) return UNVERIFIED;
  return VERIFIED;
}

/** TOOL_CONTRACTS.md: "postcondition is an immutable message receipt" — verified by confirming it reflects the actual request, not a stale or substituted one. */
export function verifyMessagePostcondition(
  raw: unknown,
  expected: { readonly idempotencyKey: string; readonly customerId: string; readonly body: string; readonly channel: "email" | "sms" },
): PostconditionResult {
  const parsed = MessageReceiptSchema.safeParse(raw);
  if (!parsed.success) return UNVERIFIED;
  const receipt: MessageReceipt = parsed.data;
  if (
    receipt.idempotencyKey !== expected.idempotencyKey ||
    receipt.customerId !== expected.customerId ||
    receipt.body !== expected.body ||
    receipt.channel !== expected.channel
  ) {
    return UNVERIFIED;
  }
  return VERIFIED;
}

/** TOOL_CONTRACTS.md: "postcondition is a refund ledger record matching order version and amount" (version excluded — see refund-adapter.ts's documented reasoning; not part of this contract's params). */
export function verifyRefundPostcondition(
  raw: unknown,
  expected: { readonly idempotencyKey: string; readonly orderId: string; readonly amountMinorInteger: number },
): PostconditionResult {
  const parsed = RefundReceiptSchema.safeParse(raw);
  if (!parsed.success) return UNVERIFIED;
  const receipt: RefundReceipt = parsed.data;
  if (
    receipt.idempotencyKey !== expected.idempotencyKey ||
    receipt.orderId !== expected.orderId ||
    receipt.amountMinorInteger !== expected.amountMinorInteger
  ) {
    return UNVERIFIED;
  }
  return VERIFIED;
}

export type PostconditionExpectation =
  | { readonly actionType: "create_internal_ticket"; readonly idempotencyKey: string }
  | { readonly actionType: "send_customer_message"; readonly idempotencyKey: string; readonly customerId: string; readonly body: string; readonly channel: "email" | "sms" }
  | { readonly actionType: "issue_refund"; readonly idempotencyKey: string; readonly orderId: string; readonly amountMinorInteger: number };

/**
 * The dispatcher `executeAction` (Gate 6/7, `packages/gateway`) calls after
 * every successful adapter response, and again during reconciliation after
 * an `UNKNOWN_OUTCOME` lookup resolves. Never trusts the adapter's own
 * claim of success — HTTP-200-equivalent or any narration text — only this
 * function's own re-derivation of the postcondition from the receipt.
 */
export function verifyPostcondition(actionType: ActionType, raw: unknown, expected: PostconditionExpectation): PostconditionResult {
  switch (actionType) {
    case "create_internal_ticket":
      if (expected.actionType !== "create_internal_ticket") return UNVERIFIED;
      return verifyTicketPostcondition(raw, expected);
    case "send_customer_message":
      if (expected.actionType !== "send_customer_message") return UNVERIFIED;
      return verifyMessagePostcondition(raw, expected);
    case "issue_refund":
      if (expected.actionType !== "issue_refund") return UNVERIFIED;
      return verifyRefundPostcondition(raw, expected);
    case "update_ticket_status":
      return UNVERIFIED; // no implemented tool contract — see contracts/src/index.ts RawAction
  }
}
