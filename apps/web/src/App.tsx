import { useEffect, useState } from "react";
import { approveRun, ApiError, createRun, getRun, listScenarios, reconcileRun, replayRun, simulateDrift, verifyRunLedger } from "./api/client.js";
import type { RunView, ScenarioMeta } from "./api/types.js";
import { RunControlRoom } from "./components/RunControlRoom.js";
import { RunList } from "./components/RunList.js";
import { ScenarioPicker } from "./components/ScenarioPicker.js";

export function App() {
  const [scenarios, setScenarios] = useState<readonly ScenarioMeta[]>([]);
  const [runs, setRuns] = useState<Record<string, RunView>>({});
  const [runOrder, setRunOrder] = useState<readonly string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [ledgerIntegrityFailedFor, setLedgerIntegrityFailedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listScenarios()
      .then((res) => setScenarios(res.scenarios))
      .catch((err: unknown) => setError(describeError(err)));
  }, []);

  function upsertRun(run: RunView): void {
    setRuns((prev) => ({ ...prev, [run.runId]: run }));
    setRunOrder((prev) => (prev.includes(run.runId) ? prev : [run.runId, ...prev]));
  }

  async function withBusy<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(describeError(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleStart(scenarioId: string): Promise<void> {
    const result = await withBusy(() => createRun(scenarioId));
    if (result === undefined) return;
    upsertRun(result.run);
    setSelectedRunId(result.run.runId);
    setLedgerIntegrityFailedFor(null);
  }

  async function handleAction(action: string): Promise<void> {
    if (selectedRunId === null) return;
    const runId = selectedRunId;

    if (action === "verify_ledger") {
      const result = await withBusy(async () => {
        const verify = await verifyRunLedger(runId);
        const refreshed = await getRun(runId);
        return { verify, refreshed };
      });
      if (result === undefined) return;
      upsertRun(result.refreshed.run);
      setLedgerIntegrityFailedFor(result.verify.result.ok ? null : runId);
      return;
    }

    const dispatch: Record<string, (id: string) => Promise<{ readonly run: RunView }>> = {
      approve: approveRun,
      simulate_drift: simulateDrift,
      replay: replayRun,
      reconcile: reconcileRun,
    };
    const call = dispatch[action];
    if (call === undefined) return;

    const result = await withBusy(() => call(runId));
    if (result === undefined) return;
    upsertRun(result.run);
  }

  const orderedRuns = runOrder.map((id) => runs[id]).filter((r): r is RunView => r !== undefined);
  const selectedRun = selectedRunId === null ? null : (runs[selectedRunId] ?? null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>ActionHarbor — Run Control Room</h1>
        <p className="app__banner">Simulated tool — no external side effect. The model proposes; only deterministic server code decides, authorizes, and executes.</p>
      </header>

      {error !== null && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}

      <div className="app__layout">
        <aside className="app__sidebar">
          <ScenarioPicker scenarios={scenarios} onStart={(id) => void handleStart(id)} busy={busy} />
          <RunList runs={orderedRuns} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
        </aside>

        <main className="app__main">
          {selectedRun === null ? (
            <p className="panel__hint">Start a scenario to see the real proposal → policy → approval → capability → execution → verification → audit trail.</p>
          ) : (
            <RunControlRoom
              run={selectedRun}
              busy={busy}
              ledgerIntegrityFailed={ledgerIntegrityFailedFor === selectedRun.runId}
              onAction={(action) => void handleAction(action)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
