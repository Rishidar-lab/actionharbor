import { useState } from "react";
import { verifyLedgerPreview } from "../api/client.js";
import type { RunView } from "../api/types.js";

function truncateHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 14)}…${hash.slice(-6)}`;
}

/** UX_SPEC.md "audit timeline": server-authored events only, failure/refusal states first-class — every event's `actor.kind` is rendered, so a viewer can see at a glance that none of them is "model." */
export function AuditTimeline({ run }: { readonly run: RunView }) {
  const [tamperResult, setTamperResult] = useState<{ readonly ok: boolean; readonly reasonCode?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function runTamperDemo() {
    if (run.ledger.length === 0) return;
    setChecking(true);
    try {
      const first = run.ledger[0];
      if (first === undefined) return;
      const tampered = run.ledger.map((entry, index) =>
        index === 0 ? { ...entry, payload: { ...entry.payload, __tampered_for_demo__: true } } : entry,
      );
      const { result } = await verifyLedgerPreview(tampered);
      setTamperResult(result.ok ? { ok: true } : { ok: false, reasonCode: result.reasonCode });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="panel audit-timeline" aria-labelledby="audit-heading">
      <div className="audit-timeline__header">
        <h3 id="audit-heading">Audit timeline</h3>
        <button type="button" className="button button--ghost" disabled={checking || run.ledger.length === 0} onClick={() => void runTamperDemo()}>
          {checking ? "Checking…" : "Try tampering (sandbox copy)"}
        </button>
      </div>
      {tamperResult !== null && (
        <p className={`callout callout--${tamperResult.ok ? "success" : "danger"}`} role="status">
          {tamperResult.ok
            ? "Sandbox copy still verified — this should not happen for a genuinely tampered copy."
            : `Sandbox copy FAILED integrity: ${tamperResult.reasonCode}. This is a copy — the real ledger below is untouched.`}
        </p>
      )}
      <div className="table-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Type</th>
              <th scope="col">Actor</th>
              <th scope="col">Occurred at</th>
              <th scope="col">Hash</th>
            </tr>
          </thead>
          <tbody>
            {run.ledger.map((event) => (
              <tr key={event.eventId}>
                <td>{event.sequence}</td>
                <td>
                  <code>{event.type}</code>
                </td>
                <td>{event.actor.kind}</td>
                <td>{event.occurredAt}</td>
                <td className="hash" title={event.hash}>
                  {truncateHash(event.hash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
