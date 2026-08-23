import type { RunView } from "../api/types.js";

const OUTCOME_TONE: Record<string, string> = { ALLOW: "success", REQUIRE_APPROVAL: "warning", DENY: "danger" };

export function PolicyPanel({ run }: { readonly run: RunView }) {
  const tone = OUTCOME_TONE[run.policy.outcome] ?? "neutral";
  return (
    <section className="panel" aria-labelledby="policy-heading">
      <h3 id="policy-heading">Policy decision</h3>
      <p className="panel__hint">Deterministic. The model never supplies a policy outcome.</p>
      <p>
        <span className={`state-badge state-badge--${tone}`}>{run.policy.outcome}</span>
      </p>
      <dl className="kv">
        <dt>Reason codes</dt>
        <dd>
          {run.policy.reasonCodes.length === 0 ? (
            <em>none</em>
          ) : (
            <span className="chip-list">
              {run.policy.reasonCodes.map((code) => (
                <code key={code} className="chip">
                  {code}
                </code>
              ))}
            </span>
          )}
        </dd>
        <dt>Policy version</dt>
        <dd>
          <code>{run.policy.policyVersion}</code>
        </dd>
      </dl>
    </section>
  );
}
