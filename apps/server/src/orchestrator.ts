import type {
  Approval,
  Capability,
  CapabilityRequest,
  CreateInternalTicketParameters,
  MessageReceipt,
  Principal,
  RunState,
  RunStateTrigger,
  SendCustomerMessageParameters,
  TicketReceipt,
} from "@actionharbor/contracts";
import { FakeMessageAdapter, FakeRefundAdapter } from "@actionharbor/adapters";
import { computeProposalHash, consumeApproval, transition } from "@actionharbor/domain";
import type { AdapterOperation, AdapterPort, AuthorizationEvidence, ExecuteActionResult } from "@actionharbor/gateway";
import { executeAction, mintCapability, OperationStore } from "@actionharbor/gateway";
import { AuditLedger, verifyLedgerIntegrity, type LedgerIntegrityResult } from "@actionharbor/ledger";
import { FakeModelAdapter, parseModelProposal } from "@actionharbor/model-adapter";
import { evaluatePolicy } from "@actionharbor/policy";
import { CountingAdapter } from "./adapters/counting-adapter.js";
import { SlowTicketAdapter } from "./adapters/slow-ticket-adapter.js";
import { findScenario, type ScenarioId } from "./scenarios.js";
import type { AppState, RunExecutionSummary, RunRecord } from "./state.js";

const SCHEMA_VERSION = "w3-proposal-1";
/** Deliberately far below `DEFAULT_EXECUTION_TIMEOUT_MS` (30s) — a demo has to be watchable, not spec-compliant-slow. */
const UNKNOWN_OUTCOME_TIMEOUT_MS = 50;
const UNKNOWN_OUTCOME_ADAPTER_DELAY_MS = 400;

export class OrchestratorError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID_STATE" | "UNKNOWN_SCENARIO",
    message: string,
  ) {
    super(message);
  }
}

function nowIso(state: AppState): string {
  return state.clock.now().toISOString();
}

/** Every transition here is one this orchestrator itself is certain is legal, given the call sequence above it — a failure is an orchestrator bug, not a run-time user error, so it throws rather than degrading to a fail-closed run state. */
function mustTransition(current: RunState, trigger: RunStateTrigger): RunState {
  const result = transition(current, trigger);
  if (!result.ok) {
    throw new Error(`orchestrator: illegal transition ${current} --${trigger}--> ? (orchestrator bug)`);
  }
  return result.nextState;
}

function getRunOrThrow(state: AppState, runId: string): RunRecord {
  const run = state.runs.get(runId);
  if (run === undefined) {
    throw new OrchestratorError("NOT_FOUND", `no run with id "${runId}"`);
  }
  return run;
}

function createAdapterAndStore(scenario: ScenarioId, state: AppState): { readonly adapter: unknown; readonly operationStore: unknown } {
  switch (scenario) {
    case "blocked":
      return { adapter: new CountingAdapter(new FakeRefundAdapter(state.idGenerator, state.clock)), operationStore: new OperationStore() };
    case "approval":
    case "replay":
    case "stale":
      return { adapter: new CountingAdapter(new FakeMessageAdapter(state.idGenerator, state.clock)), operationStore: new OperationStore() };
    case "unknown_outcome":
      return {
        adapter: new CountingAdapter(new SlowTicketAdapter(state.idGenerator, state.clock, UNKNOWN_OUTCOME_ADAPTER_DELAY_MS)),
        operationStore: new OperationStore(),
      };
  }
}

/**
 * The single legitimate path to a run's capability+execution, used by the
 * ALLOW path (no human needed) and the approval path alike — both just
 * differ in which `AuthorizationEvidence` they hand `mintCapability`
 * (ARCHITECTURE.md: exactly the two evidence shapes `mintCapability`
 * accepts, Gate 6).
 */
async function authorizeAndExecute(state: AppState, run: RunRecord, evidence: AuthorizationEvidence): Promise<void> {
  const request: CapabilityRequest = { principalId: run.principal.id, actionType: run.actionType, resourceId: run.resourceId, proposalHash: run.proposalHash };
  const mintResult = mintCapability(evidence, request, state.idGenerator, state.clock, 60_000);

  if (!mintResult.ok) {
    // Unreachable given how this orchestrator constructs `evidence` — kept as a fail-closed backstop, not a path any of the 5 scenarios take.
    run.execution = { ok: false, reasonCode: mintResult.reasonCode, replay: false };
    run.lastActionAt = nowIso(state);
    return;
  }

  const capability = mintResult.capability;
  run.ledger.append({
    type: "CAPABILITY_MINTED",
    actor: { kind: "server", id: "capability-minter-v1" },
    subject: { kind: "capability", id: capability.id },
    payload: { actionType: capability.actionType, resourceId: capability.resourceId, expiresAt: capability.expiresAt },
    operationId: run.operationId,
  });
  state.registry.record(capability);
  run.capability = capability;

  await executeForRun(state, run, capability, request);
}

/** Shared by the first execution attempt, a replay, and a reconciliation — the exact same call, every time, against the SAME long-lived adapter/operationStore instances (never recreated), which is what lets idempotency actually mean something across calls. */
async function executeForRun(state: AppState, run: RunRecord, capability: Capability, request: CapabilityRequest): Promise<void> {
  const operation: AdapterOperation = { operationId: run.operationId, idempotencyKey: run.idempotencyKey };
  const precondition = {
    currentProposalHash: run.proposalHash,
    currentResourceVersion: run.resourceVersionNow,
    expectedResourceVersion: run.resourceVersionAtProposal,
  };

  let result: ExecuteActionResult<unknown>;

  if (run.actionType === "send_customer_message") {
    const params = run.parameters as unknown as SendCustomerMessageParameters;
    result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: state.registry,
      operationStore: run.operationStore as OperationStore<MessageReceipt>,
      adapter: run.adapter as AdapterPort<SendCustomerMessageParameters, MessageReceipt>,
      operation,
      params,
      clock: state.clock,
      idGenerator: state.idGenerator,
      ledger: run.ledger,
      precondition,
      postcondition: { actionType: "send_customer_message", idempotencyKey: run.idempotencyKey, customerId: params.customerId, body: params.body, channel: params.channel },
    });
  } else if (run.actionType === "create_internal_ticket") {
    const params = run.parameters as unknown as CreateInternalTicketParameters;
    result = await executeAction({
      capabilityRaw: capability,
      request,
      registry: state.registry,
      operationStore: run.operationStore as OperationStore<TicketReceipt>,
      adapter: run.adapter as AdapterPort<CreateInternalTicketParameters, TicketReceipt>,
      operation,
      params,
      clock: state.clock,
      idGenerator: state.idGenerator,
      ledger: run.ledger,
      precondition,
      postcondition: { actionType: "create_internal_ticket", idempotencyKey: run.idempotencyKey },
      ...(run.scenario === "unknown_outcome" ? { timeoutMs: UNKNOWN_OUTCOME_TIMEOUT_MS } : {}),
    });
  } else {
    throw new Error(`orchestrator: no execution path wired for actionType "${run.actionType}" (only the 5 demo scenarios' action types are supported)`);
  }

  applyExecutionResult(run, result);
  run.execution = summarizeResult(result);
  run.lastActionAt = nowIso(state);
}

/** Drives `run.state` through the REAL `transition()` table (Gate 1) based on which stage `executeAction` actually reached — never a status string invented independently of the state machine. */
function applyExecutionResult(run: RunRecord, result: ExecuteActionResult<unknown>): void {
  if (result.ok) {
    if (result.reasonCode === "RECONCILED_SUCCESS") {
      run.state = mustTransition(run.state, "lookup_confirms_success");
    } else if (run.state === "AUTHORIZED") {
      run.state = mustTransition(mustTransition(run.state, "fresh_preconditions"), "postcondition_pass");
    }
    // else: a plain duplicate replay of an already-VERIFIED run — already terminal, nothing to transition.
    return;
  }

  switch (result.stage) {
    case "precondition":
      run.state = mustTransition(run.state, "plan_or_resource_changed");
      return;
    case "unknown_outcome":
      run.state = mustTransition(mustTransition(run.state, "fresh_preconditions"), "timeout_transport_ambiguity");
      return;
    case "reconciliation_required":
      run.state = mustTransition(run.state, "lookup_inconclusive");
      return;
    case "postcondition":
      run.state = mustTransition(mustTransition(run.state, "fresh_preconditions"), "deterministic_tool_failure");
      return;
    case "capability":
    case "idempotency":
    case "adapter":
      // No STATE_MACHINE.md edge exists for these from a run any of the 5
      // hero scenarios can legitimately reach — recorded on the run for
      // display (`run.execution`), state machine left untouched rather
      // than inventing an edge the frozen spec doesn't define.
      return;
  }
}

function summarizeResult(result: ExecuteActionResult<unknown>): RunExecutionSummary {
  if (result.ok) {
    return {
      ok: true,
      replay: result.replay,
      ...(result.reasonCode !== undefined ? { reasonCode: result.reasonCode } : {}),
      receipt: result.receipt as Record<string, unknown>,
    };
  }
  switch (result.stage) {
    case "capability":
    case "idempotency":
    case "postcondition":
    case "unknown_outcome":
    case "reconciliation_required":
      return { ok: false, stage: result.stage, replay: false, reasonCode: result.reasonCode };
    case "precondition":
      return { ok: false, stage: result.stage, replay: false, reasonCodes: result.reasonCodes };
    case "adapter":
      return { ok: false, stage: result.stage, replay: false, errorMessage: result.errorMessage };
  }
}

export async function createRun(state: AppState, scenarioId: string): Promise<RunRecord> {
  const meta = findScenario(scenarioId);
  if (meta === undefined) {
    throw new OrchestratorError("UNKNOWN_SCENARIO", `unknown scenario "${scenarioId}"`);
  }

  const runId = state.idGenerator.next("run");
  const principal: Principal = { id: "principal-1", role: meta.role, tenantId: "t1" };
  const resourceId = state.idGenerator.next("res");
  const resourceVersion = 1;

  const model = new FakeModelAdapter();
  const { raw } = await model.propose({ goal: meta.goal, resourceId });

  const ledger = new AuditLedger(state.idGenerator, state.clock);
  const operationId = state.idGenerator.next("op");
  const idempotencyKey = state.idGenerator.next("idem");

  ledger.append({
    type: "MODEL_PROPOSAL_RECORDED",
    actor: { kind: "model", id: "fake-model-adapter-v1" },
    subject: { kind: "action", id: runId },
    payload: { goal: meta.goal, raw },
    operationId,
  });

  const parsed = parseModelProposal(raw);
  if (!parsed.ok || parsed.actions[0] === undefined) {
    // Unreachable given scenarios.ts's fixed, keyword-crafted goals — kept as a fail-closed backstop, not a path any scenario takes.
    throw new Error(`orchestrator: scenario "${scenarioId}" produced an unparseable model proposal — this is a scenarios.ts bug, not a user error`);
  }
  const action = parsed.actions[0];

  const proposalHash = computeProposalHash({
    schemaVersion: SCHEMA_VERSION,
    actionType: action.actionType,
    resourceId: action.resourceId,
    parameters: action.parameters,
    evidenceRefs: action.evidenceRefs,
  });

  const policyVerdict = evaluatePolicy({
    principal,
    actionType: action.actionType,
    resource: { id: resourceId, type: meta.resourceType, ownerId: principal.id, tenantId: principal.tenantId, version: resourceVersion, status: "active" },
    evidenceRefs: action.evidenceRefs,
    environment: { now: state.clock.now(), knownEvidenceIds: new Set() },
  });

  ledger.append({
    type: "POLICY_DECISION",
    actor: { kind: "server", id: "policy-engine-v1" },
    subject: { kind: "action", id: runId },
    payload: { outcome: policyVerdict.outcome, reasonCodes: policyVerdict.reasonCodes },
    policyVersion: policyVerdict.policyVersion,
    operationId,
  });

  const { adapter, operationStore } = createAdapterAndStore(meta.id, state);

  const run: RunRecord = {
    runId,
    scenario: meta.id,
    createdAt: nowIso(state),
    principal,
    resourceType: meta.resourceType,
    resourceOwnerId: principal.id,
    tenantId: principal.tenantId,
    actionType: action.actionType,
    resourceId: action.resourceId,
    parameters: action.parameters,
    evidenceRefs: action.evidenceRefs,
    modelProposalRaw: raw,
    proposalHash,
    policyVerdict,
    operationId,
    idempotencyKey,
    ledger,
    adapter,
    operationStore,
    state: "PROPOSED",
    resourceVersionAtProposal: resourceVersion,
    resourceVersionNow: resourceVersion,
    drifted: false,
    lastActionAt: nowIso(state),
  };
  run.state = mustTransition(run.state, "schema_pass");
  state.runs.set(runId, run);

  if (policyVerdict.outcome === "DENY") {
    run.state = mustTransition(run.state, "policy_deny");
    return run;
  }
  if (policyVerdict.outcome === "REQUIRE_APPROVAL") {
    run.state = mustTransition(run.state, "high_risk");
    return run;
  }

  run.state = mustTransition(run.state, "low_risk_policy_allow");
  await authorizeAndExecute(state, run, { kind: "policy-allow", verdict: policyVerdict });
  return run;
}

export async function approveRun(state: AppState, runId: string): Promise<RunRecord> {
  const run = getRunOrThrow(state, runId);
  if (run.state !== "APPROVAL_REQUIRED") {
    throw new OrchestratorError("INVALID_STATE", `run "${runId}" is not awaiting approval (current state: ${run.state})`);
  }

  const approval: Approval = {
    id: state.idGenerator.next("appr"),
    proposalHash: run.proposalHash,
    approverId: "human-approver-1",
    scope: { actionType: run.actionType, resourceId: run.resourceId },
    policyVersion: run.policyVerdict.policyVersion,
    expiresAt: new Date(state.clock.now().getTime() + 10 * 60_000).toISOString(),
    approvedAt: nowIso(state),
    status: "active",
  };

  const consumed = consumeApproval(approval, { proposalHash: run.proposalHash, actionType: run.actionType, resourceId: run.resourceId }, state.clock.now());
  if (!consumed.ok) {
    // Unreachable — this orchestrator always builds `approval` fresh, scoped to exactly this run's own proposal hash and action/resource.
    throw new OrchestratorError("INVALID_STATE", `approval could not be consumed: ${consumed.reasonCode}`);
  }

  run.ledger.append({
    type: "APPROVAL_CONSUMED",
    actor: { kind: "human", id: approval.approverId },
    subject: { kind: "approval", id: approval.id },
    payload: { proposalHash: approval.proposalHash, scope: approval.scope },
    operationId: run.operationId,
  });

  run.approval = consumed.approval;
  run.state = mustTransition(run.state, "matching_approval");
  run.lastActionAt = nowIso(state);

  await authorizeAndExecute(state, run, { kind: "approved", approval: consumed.approval });
  return run;
}

/** "D. Stale approval": mutates the resource's version server-side, simulating an out-of-band change while a run sits awaiting approval — the human approving next has no way to know this happened, exactly THREAT_MODEL.md's "stale approval / TOCTOU." */
export function simulateDrift(state: AppState, runId: string): RunRecord {
  const run = getRunOrThrow(state, runId);
  if (run.state !== "APPROVAL_REQUIRED") {
    throw new OrchestratorError("INVALID_STATE", `drift can only be simulated while a run awaits approval (current state: ${run.state})`);
  }
  run.resourceVersionNow += 1;
  run.drifted = true;
  run.lastActionAt = nowIso(state);
  return run;
}

/** "C. Replay / duplicate": resubmits the identical operation through the identical `executeAction` call — same idempotency key, same adapter instance, same operationStore instance. */
export async function replayRun(state: AppState, runId: string): Promise<RunRecord> {
  const run = getRunOrThrow(state, runId);
  if (run.state !== "VERIFIED" || run.capability === undefined) {
    throw new OrchestratorError("INVALID_STATE", `run "${runId}" has nothing to replay yet (current state: ${run.state})`);
  }
  const request: CapabilityRequest = { principalId: run.principal.id, actionType: run.actionType, resourceId: run.resourceId, proposalHash: run.proposalHash };
  await executeForRun(state, run, run.capability, request);
  return run;
}

/** "E. Unknown outcome": reconciles via the SAME `executeAction` call — internally this can only reach the adapter through `adapter.lookup`, never `adapter.execute`, for a run already recorded `unknown_outcome`. */
export async function reconcileRun(state: AppState, runId: string): Promise<RunRecord> {
  const run = getRunOrThrow(state, runId);
  if (run.state !== "UNKNOWN_OUTCOME" && run.state !== "RECONCILIATION_REQUIRED") {
    throw new OrchestratorError("INVALID_STATE", `run "${runId}" is not awaiting reconciliation (current state: ${run.state})`);
  }
  if (run.capability === undefined) {
    throw new Error("orchestrator: unreachable — a run past AUTHORIZED always has a capability on record");
  }
  const request: CapabilityRequest = { principalId: run.principal.id, actionType: run.actionType, resourceId: run.resourceId, proposalHash: run.proposalHash };
  await executeForRun(state, run, run.capability, request);
  return run;
}

/** Recomputes this run's own hash chain from scratch and records the check itself as a ledger event — `AUDIT_INTEGRITY_CHECKED` is exactly what AUDIT_EVENT_SCHEMA.md lists as never model-authorable. */
export function verifyRunLedger(state: AppState, runId: string): LedgerIntegrityResult {
  const run = getRunOrThrow(state, runId);
  const result = verifyLedgerIntegrity(run.ledger.list());
  run.ledger.append({
    type: "AUDIT_INTEGRITY_CHECKED",
    actor: { kind: "server", id: "audit-verifier-v1" },
    subject: { kind: "operation", id: run.operationId },
    payload: result.ok
      ? { ok: true, checkedEntries: result.checkedEntries }
      : { ok: false, reasonCode: result.reasonCode, brokenAtSequence: result.brokenAtSequence },
    operationId: run.operationId,
  });
  return result;
}
