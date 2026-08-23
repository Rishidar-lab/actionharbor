import type { AuditEventType, AuditLedgerEntry } from "@actionharbor/contracts";

export type ProjectionStage = "proposal" | "policy" | "approval" | "capability" | "execution" | "verification";

export type OperationFinalState =
  | "NO_EVENTS"
  | "PROPOSED"
  | "POLICY_DECIDED"
  | "APPROVED"
  | "CAPABILITY_MINTED"
  | "EXECUTING"
  | "VERIFIED"
  | "FAILED"
  | "UNKNOWN_OUTCOME"
  | "RECONCILIATION_REQUIRED";

export interface OperationProjection {
  readonly operationId: string;
  readonly stagesSeen: readonly ProjectionStage[];
  readonly finalState: OperationFinalState;
  readonly events: readonly AuditLedgerEntry[];
}

function stageForEventType(type: AuditEventType): ProjectionStage | undefined {
  switch (type) {
    case "MODEL_PROPOSAL_RECORDED":
      return "proposal";
    case "POLICY_DECISION":
      return "policy";
    case "APPROVAL_CONSUMED":
      return "approval";
    case "CAPABILITY_MINTED":
      return "capability";
    case "EXECUTION_STARTED":
    case "PRECONDITION_FAILED":
      return "execution";
    case "POSTCONDITION_VERIFIED":
    case "POSTCONDITION_FAILED":
    case "EXECUTION_UNKNOWN":
    case "RECONCILIATION_REQUIRED":
      return "verification";
    case "AUDIT_INTEGRITY_CHECKED":
      return undefined;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function finalStateForEventType(type: AuditEventType, previous: OperationFinalState): OperationFinalState {
  switch (type) {
    case "MODEL_PROPOSAL_RECORDED":
      return "PROPOSED";
    case "POLICY_DECISION":
      return "POLICY_DECIDED";
    case "APPROVAL_CONSUMED":
      return "APPROVED";
    case "CAPABILITY_MINTED":
      return "CAPABILITY_MINTED";
    case "EXECUTION_STARTED":
      return "EXECUTING";
    case "PRECONDITION_FAILED":
      return "FAILED";
    case "POSTCONDITION_VERIFIED":
      return "VERIFIED";
    case "POSTCONDITION_FAILED":
      return "FAILED";
    case "EXECUTION_UNKNOWN":
      return "UNKNOWN_OUTCOME";
    case "RECONCILIATION_REQUIRED":
      return "RECONCILIATION_REQUIRED";
    case "AUDIT_INTEGRITY_CHECKED":
      return previous;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/**
 * Deterministically reconstructs a coarse view of one operation's
 * lifecycle by folding, in sequence order, over its own already-recorded
 * ledger entries — proposal, policy, approval, capability, execution,
 * verification, final state (ARCHITECTURE.md's "Verified /
 * reconciliation-required projection"). This is a pure read of history:
 * nothing here calls the model, an adapter, or any other side effect.
 * "Replay" means folding recorded events, never regenerating them.
 */
export function projectOperation(entries: readonly AuditLedgerEntry[], operationId: string): OperationProjection {
  const relevant = entries
    .filter((entry) => entry.operationId === operationId)
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const stages = new Set<ProjectionStage>();
  let finalState: OperationFinalState = relevant.length === 0 ? "NO_EVENTS" : "PROPOSED";

  for (const entry of relevant) {
    const stage = stageForEventType(entry.type);
    if (stage !== undefined) stages.add(stage);
    finalState = finalStateForEventType(entry.type, finalState);
  }

  return { operationId, stagesSeen: [...stages], finalState, events: relevant };
}
