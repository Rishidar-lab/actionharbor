import type { ActionType, Approval, Capability, Principal, ResourceType, RunState } from "@actionharbor/contracts";
import { SystemClock, UuidIdGenerator, type Clock, type IdGenerator } from "@actionharbor/domain";
import { CapabilityRegistry } from "@actionharbor/gateway";
import type { AuditLedger } from "@actionharbor/ledger";
import type { PolicyVerdict } from "@actionharbor/policy";
import type { ScenarioId } from "./scenarios.js";

export interface RunExecutionSummary {
  readonly ok: boolean;
  readonly stage?: string;
  readonly reasonCode?: string;
  readonly reasonCodes?: readonly string[];
  readonly replay: boolean;
  readonly receipt?: Record<string, unknown>;
  readonly errorMessage?: string;
}

/**
 * Everything one demo run needs, held server-side only. `capability` is
 * deliberately never put on the wire (see `views.ts`'s `toRunView` — the
 * ONLY function permitted to turn this into client-visible JSON, and it
 * omits `capability`, `adapter`, and `operationStore` entirely).
 *
 * `ledger` is per-run rather than one process-wide store: `AuditLedger`'s
 * hash chain requires globally contiguous sequence numbers, and this app
 * layer needs to show one run's chain in isolation without interleaved
 * sequence numbers from concurrent unrelated runs breaking
 * `verifyLedgerIntegrity`'s contiguity check. Nothing in Gate 8 requires a
 * single process-wide ledger — this is a legitimate scoping choice for a
 * multi-run demo host, not a weakening of the append-only/hash-chain
 * guarantee itself (each run's ledger is still append-only and fully
 * hash-chained on its own).
 */
export interface RunRecord {
  readonly runId: string;
  readonly scenario: ScenarioId;
  readonly createdAt: string;
  readonly principal: Principal;
  readonly resourceType: ResourceType;
  readonly resourceOwnerId: string;
  readonly tenantId: string;
  readonly actionType: ActionType;
  readonly resourceId: string;
  readonly parameters: Record<string, unknown>;
  readonly evidenceRefs: readonly string[];
  readonly modelProposalRaw: string;
  readonly proposalHash: string;
  readonly policyVerdict: PolicyVerdict;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly ledger: AuditLedger;
  /** Opaque to this module — cast to a concrete `AdapterPort<TParams, TReceipt>` only inside `orchestrator.ts`, where the scenario that created it is known. */
  readonly adapter: unknown;
  /** Opaque for the same reason as `adapter` — same concrete type parameter, always cast alongside it. */
  readonly operationStore: unknown;

  state: RunState;
  resourceVersionAtProposal: number;
  resourceVersionNow: number;
  drifted: boolean;
  approval?: Approval;
  capability?: Capability;
  execution?: RunExecutionSummary;
  lastActionAt: string;
}

export interface AppState {
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly registry: CapabilityRegistry;
  readonly runs: Map<string, RunRecord>;
}

export function createAppState(): AppState {
  return {
    idGenerator: new UuidIdGenerator(),
    clock: new SystemClock(),
    registry: new CapabilityRegistry(),
    runs: new Map(),
  };
}
