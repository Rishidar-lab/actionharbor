import type { AuditLedgerEntry } from "@actionharbor/contracts";
import type { LedgerIntegrityResult, RunView, ScenarioMeta } from "./types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body: unknown = await res.json();
  if (!res.ok) {
    const record = body as { readonly error?: string; readonly message?: string };
    throw new ApiError(res.status, record.error ?? "UNKNOWN_ERROR", record.message ?? `request to ${path} failed with status ${res.status}`);
  }
  return body as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function listScenarios(): Promise<{ readonly scenarios: readonly ScenarioMeta[] }> {
  return request("/api/scenarios");
}

export function listRuns(): Promise<{ readonly runs: readonly RunView[] }> {
  return request("/api/runs");
}

export function createRun(scenario: string): Promise<{ readonly run: RunView }> {
  return post("/api/runs", { scenario });
}

export function getRun(runId: string): Promise<{ readonly run: RunView }> {
  return request(`/api/runs/${encodeURIComponent(runId)}`);
}

export function approveRun(runId: string): Promise<{ readonly run: RunView }> {
  return post(`/api/runs/${encodeURIComponent(runId)}/approve`);
}

export function simulateDrift(runId: string): Promise<{ readonly run: RunView }> {
  return post(`/api/runs/${encodeURIComponent(runId)}/simulate-drift`);
}

export function replayRun(runId: string): Promise<{ readonly run: RunView }> {
  return post(`/api/runs/${encodeURIComponent(runId)}/replay`);
}

export function reconcileRun(runId: string): Promise<{ readonly run: RunView }> {
  return post(`/api/runs/${encodeURIComponent(runId)}/reconcile`);
}

export function verifyRunLedger(runId: string): Promise<{ readonly result: LedgerIntegrityResult; readonly ledger: readonly AuditLedgerEntry[] }> {
  return post(`/api/runs/${encodeURIComponent(runId)}/ledger/verify`);
}

export function verifyLedgerPreview(entries: readonly AuditLedgerEntry[]): Promise<{ readonly result: LedgerIntegrityResult }> {
  return post("/api/ledger/verify-preview", { entries });
}
