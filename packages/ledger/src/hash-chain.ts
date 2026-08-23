import type { AuditActorKind, AuditEventType, AuditLedgerEntry, AuditSubjectKind } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { hashCanonical } from "@actionharbor/domain";
import { redactPayload } from "./redact.js";

/** The `prevHash` of sequence 1 — there is no real predecessor event to point to. */
export const GENESIS_HASH = "sha256:genesis";

/**
 * Everything a caller supplies for one event; everything else
 * (`eventId`, `sequence`, `occurredAt`, `prevHash`, `hash`) is derived by
 * `AuditLedger.append` alone. There is no `actor.kind: "model"` path that
 * originates from model output anywhere in this package — callers pass
 * whatever `actor` describes who/what the *domain* attributes the event
 * to (e.g. `{kind:"human", id:"approver-1"}` for a human approval), but
 * the ledger row itself is always physically constructed by this
 * server-side module.
 */
export interface AuditEventInput {
  readonly type: AuditEventType;
  readonly actor: { readonly kind: AuditActorKind; readonly id: string };
  readonly subject: { readonly kind: AuditSubjectKind; readonly id: string };
  readonly payload: Record<string, unknown>;
  readonly runId?: string;
  readonly operationId?: string;
  readonly policyVersion?: string;
  readonly requestId?: string;
}

/**
 * `hash = SHA-256(canonical(event_without_hash) + prev_hash)`
 * (AUDIT_EVENT_SCHEMA.md). Because `prevHash` is itself a field of
 * `entryWithoutHash`, canonicalising and hashing the whole object already
 * folds `prevHash` into the digest — this is the same guarantee as the
 * doc's string-concatenation formula, expressed through the same
 * canonical-JSON hashing `computeProposalHash` already uses (Gate 1),
 * rather than a second bespoke serialisation format.
 */
export function computeEntryHash(entryWithoutHash: Omit<AuditLedgerEntry, "hash">): string {
  return hashCanonical(entryWithoutHash);
}

export function buildLedgerEntry(
  input: AuditEventInput,
  sequence: number,
  prevHash: string,
  idGenerator: IdGenerator,
  clock: Clock,
): AuditLedgerEntry {
  const entryWithoutHash: Omit<AuditLedgerEntry, "hash"> = {
    eventId: idGenerator.next("evt"),
    sequence,
    type: input.type,
    actor: input.actor,
    subject: input.subject,
    payload: redactPayload(input.payload),
    occurredAt: clock.now().toISOString(),
    prevHash,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  };
  return { ...entryWithoutHash, hash: computeEntryHash(entryWithoutHash) };
}
