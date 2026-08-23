import type { AuditLedgerEntry, RunState } from "@actionharbor/contracts";
import { findScenario } from "./scenarios.js";
import type { RunRecord } from "./state.js";

/**
 * The ONLY function permitted to turn a `RunRecord` into client-visible
 * JSON. `capability` (the raw `Capability` — nonce included) and the live
 * `adapter`/`operationStore` instances never appear here at all — "no
 * secret display" (Gate 9) means this function's return type structurally
 * cannot carry them, not that a caller remembered to strip them.
 */
export interface SafeCapabilityView {
  readonly scope: string;
  readonly resourceId: string;
  readonly expiresAt: string;
  readonly status: string;
}

export interface RunView {
  readonly runId: string;
  readonly scenario: string;
  readonly label: string;
  readonly description: string;
  readonly expectedNarrative: string;
  readonly createdAt: string;
  readonly lastActionAt: string;
  readonly state: RunState;
  readonly principal: { readonly id: string; readonly role: string; readonly tenantId: string };
  readonly resource: {
    readonly id: string;
    readonly type: string;
    readonly ownerId: string;
    readonly versionAtProposal: number;
    readonly versionNow: number;
    readonly drifted: boolean;
  };
  readonly proposal: {
    readonly actionType: string;
    readonly parameters: Record<string, unknown>;
    readonly evidenceRefs: readonly string[];
    readonly raw: string;
    readonly proposalHash: string;
  };
  readonly policy: { readonly outcome: string; readonly reasonCodes: readonly string[]; readonly policyVersion: string };
  readonly approval:
    | { readonly id: string; readonly approverId: string; readonly scope: { readonly actionType: string; readonly resourceId: string }; readonly approvedAt: string; readonly expiresAt: string; readonly status: string }
    | null;
  readonly capability: SafeCapabilityView | null;
  readonly execution: RunRecord["execution"] | null;
  readonly adapterCallCount: number;
  readonly availableActions: readonly string[];
  readonly ledger: readonly AuditLedgerEntry[];
}

function toSafeCapabilityView(run: RunRecord): SafeCapabilityView | null {
  if (run.capability === undefined) return null;
  return {
    scope: run.capability.actionType,
    resourceId: run.capability.resourceId,
    expiresAt: run.capability.expiresAt,
    status: run.capability.status,
  };
}

function readAdapterCallCount(adapter: unknown): number {
  if (adapter !== null && typeof adapter === "object" && "callCount" in adapter && typeof adapter.callCount === "number") {
    return adapter.callCount;
  }
  return 0;
}

function availableActions(run: RunRecord): readonly string[] {
  const actions: string[] = [];
  if (run.state === "APPROVAL_REQUIRED") {
    if (run.scenario === "stale" && !run.drifted) {
      actions.push("simulate_drift");
    }
    actions.push("approve");
  }
  if (run.state === "VERIFIED") {
    actions.push("replay");
  }
  if (run.state === "UNKNOWN_OUTCOME" || run.state === "RECONCILIATION_REQUIRED") {
    actions.push("reconcile");
  }
  actions.push("verify_ledger");
  return actions;
}

export function toRunView(run: RunRecord): RunView {
  const meta = findScenario(run.scenario);
  return {
    runId: run.runId,
    scenario: run.scenario,
    label: meta?.label ?? run.scenario,
    description: meta?.description ?? "",
    expectedNarrative: meta?.expectedNarrative ?? "",
    createdAt: run.createdAt,
    lastActionAt: run.lastActionAt,
    state: run.state,
    principal: { id: run.principal.id, role: run.principal.role, tenantId: run.principal.tenantId },
    resource: {
      id: run.resourceId,
      type: run.resourceType,
      ownerId: run.resourceOwnerId,
      versionAtProposal: run.resourceVersionAtProposal,
      versionNow: run.resourceVersionNow,
      drifted: run.drifted,
    },
    proposal: {
      actionType: run.actionType,
      parameters: run.parameters,
      evidenceRefs: run.evidenceRefs,
      raw: run.modelProposalRaw,
      proposalHash: run.proposalHash,
    },
    policy: { outcome: run.policyVerdict.outcome, reasonCodes: run.policyVerdict.reasonCodes, policyVersion: run.policyVerdict.policyVersion },
    approval:
      run.approval === undefined
        ? null
        : {
            id: run.approval.id,
            approverId: run.approval.approverId,
            scope: run.approval.scope,
            approvedAt: run.approval.approvedAt,
            expiresAt: run.approval.expiresAt,
            status: run.approval.status,
          },
    capability: toSafeCapabilityView(run),
    execution: run.execution ?? null,
    adapterCallCount: readAdapterCallCount(run.adapter),
    availableActions: availableActions(run),
    ledger: run.ledger.list(),
  };
}
