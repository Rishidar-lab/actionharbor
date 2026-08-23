import type { RunView } from "../api/types.js";

const EXECUTION_LABEL: Record<string, string> = {
  PROPOSED: "Not started",
  VALIDATED: "Not started",
  REJECTED: "Not started",
  DENIED: "Not started — blocked by policy",
  APPROVAL_REQUIRED: "Not started — awaiting approval",
  AUTHORIZED: "Not started — authorizing",
  STALE: "Not started — blocked, stale",
  EXPIRED: "Not started — approval expired",
  EXECUTING: "Executing",
  VERIFIED: "Succeeded",
  FAILED: "Failed",
  UNKNOWN_OUTCOME: "Unknown outcome",
  RECONCILIATION_REQUIRED: "Unknown outcome — still unresolved",
  REVOKED: "Not started — revoked",
  CONFLICT: "Not started — conflict",
};

export function ExecutionPanel({ run }: { readonly run: RunView }) {
  return (
    <section className="panel" aria-labelledby="execution-heading">
      <h3 id="execution-heading">Execution</h3>
      <p>{EXECUTION_LABEL[run.state] ?? run.state}</p>
      <dl className="kv">
        <dt>Adapter calls (real, counted)</dt>
        <dd>{run.adapterCallCount}</dd>
        {run.execution?.errorMessage !== undefined && (
          <>
            <dt>Error</dt>
            <dd>{run.execution.errorMessage}</dd>
          </>
        )}
        {run.execution?.receipt !== undefined && (
          <>
            <dt>Adapter receipt</dt>
            <dd>
              <pre className="code-block">{JSON.stringify(run.execution.receipt, null, 2)}</pre>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
