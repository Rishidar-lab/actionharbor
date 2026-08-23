import type { RunView } from "../api/types.js";

/** UX_SPEC.md + Gate 9: "Do not expose raw security token material. Show safe metadata only: scope, resource, expiry, status." The `capability` field on `RunView` structurally cannot carry a nonce or capability id — see apps/server/src/views.ts. */
export function CapabilityPanel({ run }: { readonly run: RunView }) {
  return (
    <section className="panel" aria-labelledby="capability-heading">
      <h3 id="capability-heading">Capability</h3>
      {run.capability === null ? (
        <p className="panel__hint">No capability has been minted for this run.</p>
      ) : (
        <dl className="kv">
          <dt>Scope</dt>
          <dd>
            <code>{run.capability.scope}</code>
          </dd>
          <dt>Resource</dt>
          <dd>
            <code>{run.capability.resourceId}</code>
          </dd>
          <dt>Expires at</dt>
          <dd>{run.capability.expiresAt}</dd>
          <dt>Status</dt>
          <dd>{run.capability.status}</dd>
        </dl>
      )}
    </section>
  );
}
