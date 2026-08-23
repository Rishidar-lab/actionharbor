import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AuditLedgerEntry } from "@actionharbor/contracts";
import { verifyLedgerIntegrity } from "@actionharbor/ledger";
import { approveRun, createRun, OrchestratorError, reconcileRun, replayRun, simulateDrift, verifyRunLedger } from "../orchestrator.js";
import { SCENARIOS } from "../scenarios.js";
import type { AppState } from "../state.js";
import { toRunView } from "../views.js";

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new OrchestratorError("INVALID_STATE", "request body too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OrchestratorError("INVALID_STATE", "request body is not valid JSON");
  }
}

function errorStatus(error: unknown): number {
  if (error instanceof OrchestratorError) {
    switch (error.code) {
      case "NOT_FOUND":
        return 404;
      case "UNKNOWN_SCENARIO":
      case "INVALID_STATE":
        return 400;
    }
  }
  return 500;
}

type Handler = (state: AppState, req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    "^" +
      path
        .split("/")
        .map((segment) => {
          if (segment.startsWith(":")) {
            paramNames.push(segment.slice(1));
            return "([^/]+)";
          }
          return segment;
        })
        .join("/") +
      "$",
  );
  return { method, pattern, paramNames, handler };
}

const ROUTES: readonly Route[] = [
  route("GET", "/api/scenarios", async (_state, _req, res) => {
    sendJson(res, 200, { scenarios: SCENARIOS });
  }),

  route("GET", "/api/runs", async (state, _req, res) => {
    sendJson(res, 200, { runs: [...state.runs.values()].map(toRunView) });
  }),

  route("POST", "/api/runs", async (state, req, res) => {
    const body = await readJsonBody(req);
    const scenario = typeof body === "object" && body !== null && "scenario" in body ? String((body as Record<string, unknown>)["scenario"]) : "";
    const run = await createRun(state, scenario);
    sendJson(res, 201, { run: toRunView(run) });
  }),

  route("GET", "/api/runs/:id", async (state, _req, res, params) => {
    const run = state.runs.get(params["id"] ?? "");
    if (run === undefined) {
      sendJson(res, 404, { error: "NOT_FOUND", message: `no run with id "${params["id"] ?? ""}"` });
      return;
    }
    sendJson(res, 200, { run: toRunView(run) });
  }),

  route("POST", "/api/runs/:id/approve", async (state, _req, res, params) => {
    const run = await approveRun(state, params["id"] ?? "");
    sendJson(res, 200, { run: toRunView(run) });
  }),

  route("POST", "/api/runs/:id/simulate-drift", async (state, _req, res, params) => {
    const run = simulateDrift(state, params["id"] ?? "");
    sendJson(res, 200, { run: toRunView(run) });
  }),

  route("POST", "/api/runs/:id/replay", async (state, _req, res, params) => {
    const run = await replayRun(state, params["id"] ?? "");
    sendJson(res, 200, { run: toRunView(run) });
  }),

  route("POST", "/api/runs/:id/reconcile", async (state, _req, res, params) => {
    const run = await reconcileRun(state, params["id"] ?? "");
    sendJson(res, 200, { run: toRunView(run) });
  }),

  route("POST", "/api/runs/:id/ledger/verify", async (state, _req, res, params) => {
    const result = verifyRunLedger(state, params["id"] ?? "");
    const run = state.runs.get(params["id"] ?? "");
    sendJson(res, 200, { result, ledger: run === undefined ? [] : run.ledger.list() });
  }),

  // A sandbox check over a client-submitted (possibly edited-to-demonstrate-tampering) copy of a
  // ledger. Pure and stateless: never appends to any real ledger, never touches run state — this
  // is what lets the UI show "AUDIT INTEGRITY FAILED" for a deliberately tampered copy without
  // ever being able to actually corrupt the real append-only store.
  route("POST", "/api/ledger/verify-preview", async (_state, req, res) => {
    const body = await readJsonBody(req);
    const rawEntries = typeof body === "object" && body !== null && "entries" in body ? (body as Record<string, unknown>)["entries"] : undefined;
    const parsed = AuditLedgerEntry.array().safeParse(rawEntries);
    if (!parsed.success) {
      sendJson(res, 400, { error: "INVALID_LEDGER_ENTRIES", message: parsed.error.message });
      return;
    }
    sendJson(res, 200, { result: verifyLedgerIntegrity(parsed.data) });
  }),
];

export function createHttpServer(state: AppState) {
  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          });
          res.end();
          return;
        }
        for (const candidate of ROUTES) {
          if (candidate.method !== req.method) continue;
          const match = candidate.pattern.exec(url.pathname);
          if (match === null) continue;
          const params: Record<string, string> = {};
          candidate.paramNames.forEach((name, index) => {
            params[name] = decodeURIComponent(match[index + 1] ?? "");
          });
          await candidate.handler(state, req, res, params);
          return;
        }
        sendJson(res, 404, { error: "NOT_FOUND", message: `no route for ${req.method ?? "?"} ${url.pathname}` });
      } catch (error) {
        sendJson(res, errorStatus(error), {
          error: error instanceof OrchestratorError ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}
