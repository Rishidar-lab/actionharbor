import type { RunView } from "../api/types.js";

type CheckStatus = "not_reached" | "passed" | "failed" | "unknown";

function precondition(run: RunView): CheckStatus {
  if (run.execution === null) return "not_reached";
  if (!run.execution.ok && run.execution.stage === "precondition") return "failed";
  return "passed";
}

function postcondition(run: RunView): CheckStatus {
  if (run.execution === null) return "not_reached";
  if (!run.execution.ok && run.execution.stage === "precondition") return "not_reached";
  if (!run.execution.ok && (run.execution.stage === "unknown_outcome" || run.execution.stage === "reconciliation_required")) return "unknown";
  if (!run.execution.ok && run.execution.stage === "postcondition") return "failed";
  if (run.execution.ok) return "passed";
  return "unknown";
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  not_reached: "Not reached",
  passed: "Passed",
  failed: "Failed",
  unknown: "Unknown — pending reconciliation",
};

const STATUS_TONE: Record<CheckStatus, string> = {
  not_reached: "neutral",
  passed: "success",
  failed: "danger",
  unknown: "warning",
};

/** UX_SPEC.md: show precondition and postcondition state SEPARATELY from the raw adapter response — never inferred from "HTTP 200" or adapter narration alone. */
export function VerificationPanel({ run }: { readonly run: RunView }) {
  const pre = precondition(run);
  const post = postcondition(run);
  return (
    <section className="panel" aria-labelledby="verification-heading">
      <h3 id="verification-heading">Verification</h3>
      <dl className="kv">
        <dt>Precondition (freshness)</dt>
        <dd>
          <span className={`state-badge state-badge--${STATUS_TONE[pre]}`}>{STATUS_LABEL[pre]}</span>
        </dd>
        <dt>Postcondition (independent re-check of the receipt)</dt>
        <dd>
          <span className={`state-badge state-badge--${STATUS_TONE[post]}`}>{STATUS_LABEL[post]}</span>
        </dd>
        {run.execution?.reasonCode !== undefined && (
          <>
            <dt>Reason code</dt>
            <dd>
              <code>{run.execution.reasonCode}</code>
            </dd>
          </>
        )}
        {run.execution?.reasonCodes !== undefined && (
          <>
            <dt>Reason codes</dt>
            <dd>
              <span className="chip-list">
                {run.execution.reasonCodes.map((code) => (
                  <code key={code} className="chip">
                    {code}
                  </code>
                ))}
              </span>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
