import type { ResourceType, Role } from "@actionharbor/contracts";

export type ScenarioId = "blocked" | "approval" | "replay" | "stale" | "unknown_outcome";

export interface ScenarioMeta {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
  readonly role: Role;
  readonly goal: string;
  readonly resourceType: ResourceType;
  /** UX_SPEC.md demo banner: "Simulated tool — no external side effect." */
  readonly expectedNarrative: string;
}

/**
 * The 5 stable synthetic demo flows Gate 9 requires (UX_SPEC.md "hero demo
 * flows"). Each `goal` string is deliberately worded to trigger exactly ONE
 * action type out of `FakeModelAdapter`'s keyword matching — never more than
 * one — so `parseModelProposal`'s `actions[0]` is unambiguous.
 */
export const SCENARIOS: readonly ScenarioMeta[] = [
  {
    id: "blocked",
    label: "A. Blocked action",
    description: "The model proposes a refund. Policy denies it before any capability can exist — no adapter side effect, ever.",
    role: "operator",
    goal: "issue a refund for the damaged order",
    resourceType: "order",
    expectedNarrative: "DENIED — MISSING_FINANCE_ROLE, HIGH_IMPACT. No capability. No adapter call.",
  },
  {
    id: "approval",
    label: "B. Approval path",
    description: "The model proposes a customer message. A human approves the exact plan hash; the capability is minted only after that; the adapter runs exactly once.",
    role: "operator",
    goal: "send the customer a message about the shipping delay",
    resourceType: "customer",
    expectedNarrative: "REQUIRE_APPROVAL -> approve -> capability minted -> adapter executes once -> postcondition verified -> VERIFIED.",
  },
  {
    id: "replay",
    label: "C. Replay / duplicate",
    description: "Same approval path as B. After it succeeds, replay the identical operation — the adapter must not be called a second time.",
    role: "operator",
    goal: "send the customer a message about their refund status",
    resourceType: "customer",
    expectedNarrative: "Second submission of the same idempotency key returns the same receipt; adapter call count stays at 1.",
  },
  {
    id: "stale",
    label: "D. Stale approval",
    description: "Approval is granted, but the resource changes underneath it before execution. The now-stale capability cannot run.",
    role: "operator",
    goal: "send the customer a message about a billing question",
    resourceType: "customer",
    expectedNarrative: "Resource drifts after approval -> precondition check fails -> STALE. No execution.",
  },
  {
    id: "unknown_outcome",
    label: "E. Unknown outcome",
    description: "The adapter call times out after it may have already taken effect. Reported as UNKNOWN_OUTCOME, resolved only by reconciliation — never by blind retry.",
    role: "operator",
    goal: "open an incident ticket for the payment failure",
    resourceType: "ticket",
    expectedNarrative: "Adapter is slower than the execution budget -> UNKNOWN_OUTCOME -> Reconcile (read-only lookup, never re-executes) -> VERIFIED (RECONCILED_SUCCESS).",
  },
];

export function findScenario(id: string): ScenarioMeta | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
