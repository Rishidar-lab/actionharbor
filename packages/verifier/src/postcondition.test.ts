import { describe, expect, it } from "vitest";
import {
  verifyMessagePostcondition,
  verifyPostcondition,
  verifyRefundPostcondition,
  verifyTicketPostcondition,
} from "./postcondition.js";

const VALID_TICKET = {
  ticketId: "tix_1",
  status: "open",
  title: "Cold-chain check",
  priority: "high",
  idempotencyKey: "key-1",
  resourceId: "incident-1",
  createdAt: "2026-08-22T09:00:00Z",
};

describe("verifyTicketPostcondition", () => {
  it("test 1 (adapter success, postcondition true) -> VERIFIED", () => {
    expect(verifyTicketPostcondition(VALID_TICKET, { idempotencyKey: "key-1" })).toEqual({ ok: true });
  });

  it("test 2 (adapter returns a well-formed receipt, but for a DIFFERENT operation) -> postcondition false, NOT verified", () => {
    const result = verifyTicketPostcondition(VALID_TICKET, { idempotencyKey: "some-other-key" });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });

  it("w3-020 'Tool receipt missing postcondition': an empty/malformed receipt ({}) fails closed as POSTCONDITION_UNVERIFIED, not thrown, not silently accepted", () => {
    const result = verifyTicketPostcondition({}, { idempotencyKey: "key-1" });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });

  it("a receipt that is not even an object (e.g. a raw string, simulating a garbled response) fails closed", () => {
    expect(verifyTicketPostcondition("not a receipt", { idempotencyKey: "key-1" })).toEqual({
      ok: false,
      reasonCode: "POSTCONDITION_UNVERIFIED",
    });
  });

  it("does not trust a fabricated 'verified: true' field smuggled into the receipt — strict schema rejects it same as Gate 4", () => {
    const result = verifyTicketPostcondition({ ...VALID_TICKET, verified: true }, { idempotencyKey: "key-1" });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });
});

const VALID_MESSAGE = {
  messageId: "msg_1",
  customerId: "customer-1",
  body: "Your delivery is delayed.",
  channel: "email",
  idempotencyKey: "key-1",
  resourceId: "customer-1",
  sentAt: "2026-08-22T09:00:00Z",
};

describe("verifyMessagePostcondition", () => {
  it("a receipt matching exactly what was requested -> VERIFIED", () => {
    const result = verifyMessagePostcondition(VALID_MESSAGE, {
      idempotencyKey: "key-1",
      customerId: "customer-1",
      body: "Your delivery is delayed.",
      channel: "email",
    });
    expect(result).toEqual({ ok: true });
  });

  it("a receipt whose body does not match what was requested is not verified (stale or substituted response)", () => {
    const result = verifyMessagePostcondition(VALID_MESSAGE, {
      idempotencyKey: "key-1",
      customerId: "customer-1",
      body: "A completely different message.",
      channel: "email",
    });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });

  it("a receipt for the wrong customer is not verified", () => {
    const result = verifyMessagePostcondition(VALID_MESSAGE, {
      idempotencyKey: "key-1",
      customerId: "someone-else",
      body: "Your delivery is delayed.",
      channel: "email",
    });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });
});

const VALID_REFUND = {
  refundId: "rfnd_1",
  orderId: "order-1",
  amountMinorInteger: 2500,
  currency: "USD",
  reason: "Cold-chain failure",
  idempotencyKey: "key-1",
  resourceId: "order-1",
  issuedAt: "2026-08-22T09:00:00Z",
};

describe("verifyRefundPostcondition", () => {
  it("a receipt matching the requested order and amount -> VERIFIED", () => {
    const result = verifyRefundPostcondition(VALID_REFUND, { idempotencyKey: "key-1", orderId: "order-1", amountMinorInteger: 2500 });
    expect(result).toEqual({ ok: true });
  });

  it("a receipt whose amount does not match what was requested is not verified — the highest-stakes false-success case in the system", () => {
    const result = verifyRefundPostcondition(VALID_REFUND, { idempotencyKey: "key-1", orderId: "order-1", amountMinorInteger: 999_999 });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });

  it("a receipt for the wrong order is not verified", () => {
    const result = verifyRefundPostcondition(VALID_REFUND, { idempotencyKey: "key-1", orderId: "order-999", amountMinorInteger: 2500 });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });
});

describe("verifyPostcondition — dispatcher", () => {
  it("routes to the ticket verifier for create_internal_ticket", () => {
    const result = verifyPostcondition("create_internal_ticket", VALID_TICKET, { actionType: "create_internal_ticket", idempotencyKey: "key-1" });
    expect(result).toEqual({ ok: true });
  });

  it("routes to the message verifier for send_customer_message", () => {
    const result = verifyPostcondition("send_customer_message", VALID_MESSAGE, {
      actionType: "send_customer_message",
      idempotencyKey: "key-1",
      customerId: "customer-1",
      body: "Your delivery is delayed.",
      channel: "email",
    });
    expect(result).toEqual({ ok: true });
  });

  it("routes to the refund verifier for issue_refund", () => {
    const result = verifyPostcondition("issue_refund", VALID_REFUND, {
      actionType: "issue_refund",
      idempotencyKey: "key-1",
      orderId: "order-1",
      amountMinorInteger: 2500,
    });
    expect(result).toEqual({ ok: true });
  });

  it("update_ticket_status has no implemented postcondition and is always unverified", () => {
    const result = verifyPostcondition("update_ticket_status", {}, { actionType: "create_internal_ticket", idempotencyKey: "key-1" });
    expect(result).toEqual({ ok: false, reasonCode: "POSTCONDITION_UNVERIFIED" });
  });
});
