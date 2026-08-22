import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { buildVerificationAuditEvent } from "./audit-event.js";

const NOW = new Date("2026-08-22T09:00:00Z");

describe("buildVerificationAuditEvent", () => {
  it("is always server-authored — actor.kind is always 'server', never 'model'", () => {
    const event = buildVerificationAuditEvent(
      "POSTCONDITION_VERIFIED",
      "op_1",
      { outcome: "success" },
      new CounterIdGenerator(),
      new FixedClock(NOW),
    );
    expect(event.actor).toEqual({ kind: "server", id: "execution-gateway-v1" });
  });

  it("subject is the operation, not the resource or the model's proposal", () => {
    const event = buildVerificationAuditEvent("EXECUTION_STARTED", "op_42", {}, new CounterIdGenerator(), new FixedClock(NOW));
    expect(event.subject).toEqual({ kind: "operation", id: "op_42" });
  });

  it("carries the exact type and payload passed in, and a fresh eventId and timestamp", () => {
    const event = buildVerificationAuditEvent(
      "POSTCONDITION_FAILED",
      "op_1",
      { reasonCode: "POSTCONDITION_UNVERIFIED" },
      new CounterIdGenerator(),
      new FixedClock(NOW),
    );
    expect(event.type).toBe("POSTCONDITION_FAILED");
    expect(event.payload).toEqual({ reasonCode: "POSTCONDITION_UNVERIFIED" });
    expect(event.eventId).toMatch(/^evt_\d{6}$/);
    expect(event.occurredAt).toBe(NOW.toISOString());
  });

  it("two events from the same generator get distinct, monotonic eventIds", () => {
    const idGenerator = new CounterIdGenerator();
    const clock = new FixedClock(NOW);
    const a = buildVerificationAuditEvent("EXECUTION_STARTED", "op_1", {}, idGenerator, clock);
    const b = buildVerificationAuditEvent("POSTCONDITION_VERIFIED", "op_1", {}, idGenerator, clock);
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("produces a value that validates against the VerificationAuditEvent contract schema", async () => {
    const { VerificationAuditEvent } = await import("@actionharbor/contracts");
    const event = buildVerificationAuditEvent("RECONCILIATION_REQUIRED", "op_1", { reasonCode: "UNKNOWN_OUTCOME" }, new CounterIdGenerator(), new FixedClock(NOW));
    expect(VerificationAuditEvent.safeParse(event).success).toBe(true);
  });
});
