import type { RunView } from "../api/types.js";

const ACTION_LABEL: Record<string, string> = {
  approve: "Approve exact proposal",
  simulate_drift: "Simulate resource drift",
  replay: "Replay same operation",
  reconcile: "Reconcile (read-only lookup)",
  verify_ledger: "Verify audit ledger",
};

export function ActionBar({
  run,
  busy,
  onAction,
}: {
  readonly run: RunView;
  readonly busy: boolean;
  readonly onAction: (action: string) => void;
}) {
  return (
    <div className="action-bar" role="group" aria-label="Available actions">
      {run.availableActions.map((action) => (
        <button key={action} type="button" className="button" disabled={busy} onClick={() => onAction(action)}>
          {ACTION_LABEL[action] ?? action}
        </button>
      ))}
    </div>
  );
}
