import type { AddressInfo } from "node:net";
import type { AuditLedgerEntry } from "@actionharbor/contracts";
import type { LedgerIntegrityResult } from "@actionharbor/ledger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunView } from "../views.js";
import { createHttpServer } from "./server.js";
import { createAppState } from "../state.js";

/**
 * The Gate 9 "integration suite": drives the demo backend over the REAL
 * wire protocol (`fetch` against a real listening `node:http` server) —
 * not the orchestrator functions directly (that's `orchestrator.test.ts`).
 * This is what proves the HTTP layer's routing, JSON body parsing, status
 * codes, and secret-omission actually work end to end.
 */

interface RunResponse {
  readonly run: RunView;
}

interface ScenariosResponse {
  readonly scenarios: readonly { readonly id: string }[];
}

interface ErrorResponse {
  readonly error: string;
  readonly message: string;
}

interface LedgerVerifyResponse {
  readonly result: LedgerIntegrityResult;
  readonly ledger: readonly AuditLedgerEntry[];
}

interface LedgerPreviewResponse {
  readonly result: LedgerIntegrityResult;
}

let baseUrl: string;
let server: ReturnType<typeof createHttpServer>;

beforeAll(async () => {
  const state = createAppState();
  server = createHttpServer(state);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

async function postJson<T>(path: string, body?: unknown): Promise<{ readonly status: number; readonly body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await res.json()) as T;
  return { status: res.status, body: parsed };
}

async function getJson<T>(path: string): Promise<{ readonly status: number; readonly body: T }> {
  const res = await fetch(`${baseUrl}${path}`);
  const parsed = (await res.json()) as T;
  return { status: res.status, body: parsed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GET /api/scenarios", () => {
  it("lists all 5 hero demo scenarios", async () => {
    const { status, body } = await getJson<ScenariosResponse>("/api/scenarios");
    expect(status).toBe(200);
    expect(body.scenarios.map((s) => s.id)).toEqual(["blocked", "approval", "replay", "stale", "unknown_outcome"]);
  });
});

describe("POST /api/runs — unknown scenario", () => {
  it("returns 400 for an unrecognized scenario id", async () => {
    const { status, body } = await postJson<ErrorResponse>("/api/runs", { scenario: "not-a-scenario" });
    expect(status).toBe(400);
    expect(body.error).toBe("UNKNOWN_SCENARIO");
  });
});

describe("GET /api/runs/:id — unknown run", () => {
  it("returns 404", async () => {
    const { status, body } = await getJson<ErrorResponse>("/api/runs/run_does_not_exist");
    expect(status).toBe(404);
    expect(body.error).toBe("NOT_FOUND");
  });
});

describe("A. Blocked action, over HTTP", () => {
  it("denies over the wire, with capability omitted (never a raw token) and adapterCallCount 0", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "blocked" });
    expect(created.status).toBe(201);
    expect(created.body.run.state).toBe("DENIED");
    expect(created.body.run.capability).toBeNull();
    expect(created.body.run.adapterCallCount).toBe(0);
    // No raw capability material anywhere in the serialized run.
    expect(JSON.stringify(created.body.run)).not.toMatch(/nonce/i);
  });
});

describe("B/C. Approval path and replay, over HTTP", () => {
  it("approves, executes once, replays without a second side effect, and the safe capability view never carries a nonce or raw id", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "replay" });
    const runId = created.body.run.runId;
    expect(created.body.run.availableActions).toContain("approve");

    const approved = await postJson<RunResponse>(`/api/runs/${runId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.run.state).toBe("VERIFIED");
    expect(approved.body.run.adapterCallCount).toBe(1);
    expect(approved.body.run.capability).toEqual({
      scope: "send_customer_message",
      resourceId: approved.body.run.resource.id,
      expiresAt: expect.any(String),
      status: "active",
    });
    expect(Object.keys(approved.body.run.capability ?? {})).toEqual(["scope", "resourceId", "expiresAt", "status"]);

    const replayed = await postJson<RunResponse>(`/api/runs/${runId}/replay`);
    expect(replayed.status).toBe(200);
    expect(replayed.body.run.adapterCallCount).toBe(1);
    expect(replayed.body.run.execution?.replay).toBe(true);
  });

  it("rejects approving a run twice with 400, and rejects replaying before verification with 400", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "approval" });
    const runId = created.body.run.runId;
    await postJson<RunResponse>(`/api/runs/${runId}/approve`);
    const secondApprove = await postJson<ErrorResponse>(`/api/runs/${runId}/approve`);
    expect(secondApprove.status).toBe(400);

    const created2 = await postJson<RunResponse>("/api/runs", { scenario: "approval" });
    const replayTooSoon = await postJson<ErrorResponse>(`/api/runs/${created2.body.run.runId}/replay`);
    expect(replayTooSoon.status).toBe(400);
  });
});

describe("D. Stale approval, over HTTP", () => {
  it("simulate-drift then approve ends STALE with no adapter call", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "stale" });
    const runId = created.body.run.runId;

    const drifted = await postJson<RunResponse>(`/api/runs/${runId}/simulate-drift`);
    expect(drifted.status).toBe(200);
    expect(drifted.body.run.resource.drifted).toBe(true);

    const approved = await postJson<RunResponse>(`/api/runs/${runId}/approve`);
    expect(approved.body.run.state).toBe("STALE");
    expect(approved.body.run.adapterCallCount).toBe(0);
  });
});

describe("E. Unknown outcome, over HTTP", () => {
  it("times out to UNKNOWN_OUTCOME, then reconcile finds the real receipt after the background call finishes", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "unknown_outcome" });
    expect(created.body.run.state).toBe("UNKNOWN_OUTCOME");
    expect(created.body.run.availableActions).toContain("reconcile");

    await sleep(600);

    const reconciled = await postJson<RunResponse>(`/api/runs/${created.body.run.runId}/reconcile`);
    expect(reconciled.body.run.state).toBe("VERIFIED");
    expect(reconciled.body.run.execution?.ok === true && reconciled.body.run.execution.reasonCode).toBe("RECONCILED_SUCCESS");
  });
});

describe("Ledger endpoints, over HTTP", () => {
  it("POST /api/runs/:id/ledger/verify reports ok for a genuine run and records AUDIT_INTEGRITY_CHECKED", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "blocked" });
    const runId = created.body.run.runId;

    const verified = await postJson<LedgerVerifyResponse>(`/api/runs/${runId}/ledger/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.result).toEqual({ ok: true, checkedEntries: 2 });
    expect(verified.body.ledger.at(-1)?.type).toBe("AUDIT_INTEGRITY_CHECKED");
  });

  it("POST /api/ledger/verify-preview detects a tampered copy without touching the real run", async () => {
    const created = await postJson<RunResponse>("/api/runs", { scenario: "blocked" });
    const runId = created.body.run.runId;
    const fetched = await getJson<RunResponse>(`/api/runs/${runId}`);
    const entries = fetched.body.run.ledger;
    const tampered = entries.map((e, i) => (i === 0 ? { ...e, payload: { ...e.payload, goal: "TAMPERED" } } : e));

    const preview = await postJson<LedgerPreviewResponse>("/api/ledger/verify-preview", { entries: tampered });
    expect(preview.status).toBe(200);
    expect(preview.body.result.ok).toBe(false);
    expect(!preview.body.result.ok && preview.body.result.reasonCode).toBe("HASH_MISMATCH");

    // The real run's own ledger is untouched by the preview check.
    const refetched = await getJson<RunResponse>(`/api/runs/${runId}`);
    expect(refetched.body.run.ledger).toEqual(fetched.body.run.ledger);
  });

  it("POST /api/ledger/verify-preview rejects entries that do not even match the ledger schema", async () => {
    const preview = await postJson<ErrorResponse>("/api/ledger/verify-preview", { entries: [{ not: "a real entry" }] });
    expect(preview.status).toBe(400);
    expect(preview.body.error).toBe("INVALID_LEDGER_ENTRIES");
  });
});

describe("CORS preflight", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
