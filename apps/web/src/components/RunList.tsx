import type { RunView } from "../api/types.js";
import { STATE_COPY } from "../state-copy.js";

export function RunList({
  runs,
  selectedRunId,
  onSelect,
}: {
  readonly runs: readonly RunView[];
  readonly selectedRunId: string | null;
  readonly onSelect: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <section className="panel run-list" aria-labelledby="run-list-heading">
        <h2 id="run-list-heading">Runs</h2>
        <p className="panel__hint">No runs yet — start one from a scenario above.</p>
      </section>
    );
  }

  return (
    <section className="panel run-list" aria-labelledby="run-list-heading">
      <h2 id="run-list-heading">Runs</h2>
      <ul className="run-list__list">
        {runs.map((run) => {
          const copy = STATE_COPY[run.state];
          const selected = run.runId === selectedRunId;
          return (
            <li key={run.runId}>
              <button type="button" className={`run-list__item${selected ? " run-list__item--selected" : ""}`} onClick={() => onSelect(run.runId)} aria-current={selected}>
                <span className={`state-dot state-dot--${copy.tone}`} aria-hidden="true" />
                <span className="run-list__item-text">
                  <span className="run-list__item-label">{run.label}</span>
                  <span className="run-list__item-state">{copy.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
