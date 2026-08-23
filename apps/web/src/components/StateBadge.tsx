import type { StateCopy } from "../state-copy.js";

export function StateBadge({ copy }: { readonly copy: StateCopy }) {
  return <span className={`state-badge state-badge--${copy.tone}`}>{copy.label}</span>;
}
