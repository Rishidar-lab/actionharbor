import { useState } from "react";
import type { RunView } from "../api/types.js";

export function ProposalPanel({ run }: { readonly run: RunView }) {
  const [tab, setTab] = useState<"validated" | "raw">("validated");

  return (
    <section className="panel" aria-labelledby="proposal-heading">
      <h3 id="proposal-heading">Proposal</h3>
      <p className="panel__hint">Untrusted model output. The model proposes; nothing here is authority to act.</p>
      <div className="tabs" role="tablist" aria-label="Proposal view">
        <button type="button" role="tab" aria-selected={tab === "validated"} className={`tabs__button${tab === "validated" ? " tabs__button--active" : ""}`} onClick={() => setTab("validated")}>
          Validated
        </button>
        <button type="button" role="tab" aria-selected={tab === "raw"} className={`tabs__button${tab === "raw" ? " tabs__button--active" : ""}`} onClick={() => setTab("raw")}>
          Raw
        </button>
      </div>
      {tab === "validated" ? (
        <dl className="kv">
          <dt>Action type</dt>
          <dd>
            <code>{run.proposal.actionType}</code>
          </dd>
          <dt>Resource</dt>
          <dd>
            <code>{run.resource.id}</code> ({run.resource.type})
          </dd>
          <dt>Parameters</dt>
          <dd>
            <pre className="code-block">{JSON.stringify(run.proposal.parameters, null, 2)}</pre>
          </dd>
          <dt>Evidence refs</dt>
          <dd>{run.proposal.evidenceRefs.length === 0 ? <em>none</em> : run.proposal.evidenceRefs.join(", ")}</dd>
          <dt>Plan hash</dt>
          <dd className="hash">{run.proposal.proposalHash}</dd>
        </dl>
      ) : (
        <pre className="code-block code-block--scroll">{run.proposal.raw}</pre>
      )}
    </section>
  );
}
