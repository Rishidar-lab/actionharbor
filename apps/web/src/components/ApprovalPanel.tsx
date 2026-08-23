import type { RunView } from "../api/types.js";

/** UX_SPEC.md: "The approval screen must show exact action type, resource, parameters, evidence references, policy version, plan hash, expiry, and the fact that approval cannot be reused after material change." */
export function ApprovalPanel({ run }: { readonly run: RunView }) {
  if (run.state !== "APPROVAL_REQUIRED" && run.approval === null) {
    return null;
  }

  return (
    <section className="panel" aria-labelledby="approval-heading">
      <h3 id="approval-heading">Approval</h3>
      {run.approval === null ? (
        <>
          <p className="panel__hint">Awaiting a human to approve this EXACT proposal — bound to the plan hash below.</p>
          <dl className="kv">
            <dt>Action type</dt>
            <dd>
              <code>{run.proposal.actionType}</code>
            </dd>
            <dt>Resource</dt>
            <dd>
              <code>{run.resource.id}</code>
            </dd>
            <dt>Parameters</dt>
            <dd>
              <pre className="code-block">{JSON.stringify(run.proposal.parameters, null, 2)}</pre>
            </dd>
            <dt>Policy version</dt>
            <dd>
              <code>{run.policy.policyVersion}</code>
            </dd>
            <dt>Plan hash</dt>
            <dd className="hash">{run.proposal.proposalHash}</dd>
          </dl>
          <p className="panel__note">This approval cannot be reused if the plan or the resource changes materially after it is granted.</p>
        </>
      ) : (
        <dl className="kv">
          <dt>Approver</dt>
          <dd>{run.approval.approverId}</dd>
          <dt>Scope</dt>
          <dd>
            <code>{run.approval.scope.actionType}</code> on <code>{run.approval.scope.resourceId}</code>
          </dd>
          <dt>Approved at</dt>
          <dd>{run.approval.approvedAt}</dd>
          <dt>Expires at</dt>
          <dd>{run.approval.expiresAt}</dd>
          <dt>Status</dt>
          <dd>{run.approval.status}</dd>
        </dl>
      )}
    </section>
  );
}
