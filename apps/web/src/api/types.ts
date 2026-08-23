import type { AuditLedgerEntry, RunState } from "@actionharbor/contracts";

/**
 * Hand-mirrors `apps/server/src/views.ts`'s `RunView` — deliberately NOT
 * imported from `@actionharbor/server` (that package's entry point starts
 * an HTTP server as a side effect; the browser bundle must never pull in
 * server code, only agree with it on the wire shape). `RunState` and
 * `AuditLedgerEntry` ARE imported directly from `@actionharbor/contracts`
 * — pure `type`-only imports are fully erased at build time
 * (`verbatimModuleSyntax`), so this never bundles any runtime code
 * (`node:crypto` included) into the browser.
 */

export interface ScenarioMeta {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly role: string;
  readonly goal: string;
  readonly resourceType: string;
  readonly expectedNarrative: string;
}

export interface SafeCapabilityView {
  readonly scope: string;
  readonly resourceId: string;
  readonly expiresAt: string;
  readonly status: string;
}

export interface RunExecutionSummary {
  readonly ok: boolean;
  readonly stage?: string;
  readonly reasonCode?: string;
  readonly reasonCodes?: readonly string[];
  readonly replay: boolean;
  readonly receipt?: Record<string, unknown>;
  readonly errorMessage?: string;
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
    | {
        readonly id: string;
        readonly approverId: string;
        readonly scope: { readonly actionType: string; readonly resourceId: string };
        readonly approvedAt: string;
        readonly expiresAt: string;
        readonly status: string;
      }
    | null;
  readonly capability: SafeCapabilityView | null;
  readonly execution: RunExecutionSummary | null;
  readonly adapterCallCount: number;
  readonly availableActions: readonly string[];
  readonly ledger: readonly AuditLedgerEntry[];
}

export type LedgerIntegrityResult =
  | { readonly ok: true; readonly checkedEntries: number }
  | { readonly ok: false; readonly reasonCode: string; readonly brokenAtSequence: number };
