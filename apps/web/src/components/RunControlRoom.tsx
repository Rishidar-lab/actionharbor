import type { RunView } from "../api/types.js";
import { AUDIT_INTEGRITY_FAILED_COPY, STATE_COPY } from "../state-copy.js";
import { ActionBar } from "./ActionBar.js";
import { ApprovalPanel } from "./ApprovalPanel.js";
import { AuditTimeline } from "./AuditTimeline.js";
import { CapabilityPanel } from "./CapabilityPanel.js";
import { ExecutionPanel } from "./ExecutionPanel.js";
import { PolicyPanel } from "./PolicyPanel.js";
import { ProposalPanel } from "./ProposalPanel.js";
import { StateBadge } from "./StateBadge.js";
import { VerificationPanel } from "./VerificationPanel.js";

export function RunControlRoom({
  run,
  busy,
  ledgerIntegrityFailed,
  onAction,
}: {
  readonly run: RunView;
  readonly busy: boolean;
  readonly ledgerIntegrityFailed: boolean;
  readonly onAction: (action: string) => void;
}) {
  const copy = ledgerIntegrityFailed ? AUDIT_INTEGRITY_FAILED_COPY : STATE_COPY[run.state];

  return (
    <div className="control-room">
      <header className="control-room__header">
        <div>
          <h2>{run.label}</h2>
          <p className="panel__hint">{run.description}</p>
        </div>
        <StateBadge copy={copy} />
      </header>

      <div className="callout-grid" role="status" aria-live="polite">
        <div className="callout">
          <strong>What happened</strong>
          <p>{copy.whatHappened}</p>
        </div>
        <div className="callout">
          <strong>What cannot happen</strong>
          <p>{copy.whatCannotHappen}</p>
        </div>
        <div className="callout">
          <strong>Safe next action</strong>
          <p>{copy.safeNextAction}</p>
        </div>
      </div>

      <ActionBar run={run} busy={busy} onAction={onAction} />

      <div className="control-room__grid">
        <ProposalPanel run={run} />
        <div className="control-room__column">
          <PolicyPanel run={run} />
          <ApprovalPanel run={run} />
        </div>
        <div className="control-room__column">
          <CapabilityPanel run={run} />
          <ExecutionPanel run={run} />
          <VerificationPanel run={run} />
        </div>
      </div>

      <AuditTimeline run={run} />
    </div>
  );
}
