import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { RunView, ScenarioMeta } from "./api/types.js";

const SCENARIOS: readonly ScenarioMeta[] = [
  { id: "blocked", label: "A. Blocked action", description: "denies", role: "operator", goal: "issue a refund", resourceType: "order", expectedNarrative: "n" },
  { id: "approval", label: "B. Approval path", description: "approves", role: "operator", goal: "send a message", resourceType: "customer", expectedNarrative: "n" },
];

function fakeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    runId: "run_1",
    scenario: "blocked",
    label: "A. Blocked action",
    description: "denies",
    expectedNarrative: "n",
    createdAt: "2026-08-23T10:00:00.000Z",
    lastActionAt: "2026-08-23T10:00:00.000Z",
    state: "DENIED",
    principal: { id: "principal-1", role: "operator", tenantId: "t1" },
    resource: { id: "res_1", type: "order", ownerId: "principal-1", versionAtProposal: 1, versionNow: 1, drifted: false },
    proposal: { actionType: "issue_refund", parameters: { orderId: "res_1" }, evidenceRefs: [], raw: "{}", proposalHash: "sha256:abc" },
    policy: { outcome: "DENY", reasonCodes: ["MISSING_FINANCE_ROLE", "HIGH_IMPACT"], policyVersion: "policy-2026-08-22.1" },
    approval: null,
    capability: null,
    execution: null,
    adapterCallCount: 0,
    availableActions: ["verify_ledger"],
    ledger: [],
    ...overrides,
  };
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/scenarios" && method === "GET") {
        return jsonResponse({ scenarios: SCENARIOS });
      }
      if (url === "/api/runs" && method === "POST") {
        return jsonResponse({ run: fakeRun() }, 201);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("App", () => {
  it("loads and renders all scenarios from the API", async () => {
    render(<App />);
    expect(await screen.findByText("A. Blocked action")).toBeInTheDocument();
    expect(screen.getByText("B. Approval path")).toBeInTheDocument();
  });

  it("starting a scenario renders the resulting run's real state — never a client-invented status", async () => {
    const user = userEvent.setup();
    render(<App />);

    const picker = await screen.findByRole("region", { name: "Hero demo flows" });
    await user.click(within(picker).getByRole("button", { name: /A\. Blocked action/ }));

    const header = await screen.findByRole("heading", { name: "A. Blocked action", level: 2 });
    const controlRoomHeader = header.closest(".control-room__header");
    if (controlRoomHeader === null) throw new Error("unreachable");
    await waitFor(() => {
      expect(within(controlRoomHeader as HTMLElement).getByText("Policy denied")).toBeInTheDocument();
    });

    // The exact server-reported reason codes are shown, not a generic "denied" message.
    expect(screen.getByText("MISSING_FINANCE_ROLE")).toBeInTheDocument();
    expect(screen.getByText("HIGH_IMPACT")).toBeInTheDocument();
  });

  it("never renders raw capability material (nonce) anywhere on the page", async () => {
    const user = userEvent.setup();
    render(<App />);
    const picker = await screen.findByRole("region", { name: "Hero demo flows" });
    await user.click(within(picker).getByRole("button", { name: /A\. Blocked action/ }));
    await screen.findByRole("heading", { name: "A. Blocked action", level: 2 });

    expect(document.body.textContent?.toLowerCase()).not.toMatch(/nonce/);
  });

  it("surfaces an API error instead of silently failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/scenarios") return jsonResponse({ error: "INTERNAL_ERROR", message: "boom" }, 500);
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/);
  });
});

describe("Run control room, once a run exists", () => {
  it("shows only the actions the server actually reports as available", async () => {
    mockFetch();
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/scenarios" && method === "GET") return jsonResponse({ scenarios: SCENARIOS });
      if (url === "/api/runs" && method === "POST") {
        return jsonResponse({ run: fakeRun({ state: "APPROVAL_REQUIRED", availableActions: ["approve", "verify_ledger"] }) }, 201);
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const user = userEvent.setup();
    render(<App />);
    const picker = await screen.findByRole("region", { name: "Hero demo flows" });
    await user.click(within(picker).getByRole("button", { name: /A\. Blocked action/ }));

    const actionBar = await screen.findByRole("group", { name: /available actions/i });
    expect(within(actionBar).getByRole("button", { name: /approve exact proposal/i })).toBeInTheDocument();
    expect(within(actionBar).queryByRole("button", { name: /replay/i })).not.toBeInTheDocument();
    expect(within(actionBar).queryByRole("button", { name: /reconcile/i })).not.toBeInTheDocument();
  });
});
