import type { ScenarioMeta } from "../api/types.js";

export function ScenarioPicker({
  scenarios,
  onStart,
  busy,
}: {
  readonly scenarios: readonly ScenarioMeta[];
  readonly onStart: (scenarioId: string) => void;
  readonly busy: boolean;
}) {
  return (
    <section className="panel scenario-picker" aria-labelledby="scenario-picker-heading">
      <h2 id="scenario-picker-heading">Hero demo flows</h2>
      <p className="panel__hint">Simulated tool — no external side effect. Every run below drives the real policy, capability, execution, and verification code.</p>
      <ul className="scenario-picker__list">
        {scenarios.map((scenario) => (
          <li key={scenario.id}>
            <button type="button" className="scenario-picker__button" disabled={busy} onClick={() => onStart(scenario.id)}>
              <span className="scenario-picker__label">{scenario.label}</span>
              <span className="scenario-picker__description">{scenario.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
