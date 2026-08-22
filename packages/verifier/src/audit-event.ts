import type { AuditEventType, VerificationAuditEvent } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";

/**
 * Constructs a `VerificationAuditEvent` — always `actor: {kind: "server"}`,
 * always built from already-deterministic inputs (an operation id, a
 * payload object made of values the verification logic itself computed).
 * There is no parameter here through which model output could reach a
 * field of the resulting event; "the model must not author authoritative
 * audit events" is true of this function by construction, not by
 * convention.
 *
 * Not persisted anywhere yet — Gate 8's ledger owns sequencing, hash
 * chaining, and the append-only store. This is the record that ledger
 * will wrap.
 */
export function buildVerificationAuditEvent(
  type: AuditEventType,
  operationId: string,
  payload: Record<string, unknown>,
  idGenerator: IdGenerator,
  clock: Clock,
): VerificationAuditEvent {
  return {
    eventId: idGenerator.next("evt"),
    type,
    actor: { kind: "server", id: "execution-gateway-v1" },
    subject: { kind: "operation", id: operationId },
    payload,
    occurredAt: clock.now().toISOString(),
  };
}
