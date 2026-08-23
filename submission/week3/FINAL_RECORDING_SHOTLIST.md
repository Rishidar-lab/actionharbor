# ActionHarbor — Final Recording Shot List

Target duration: **90–120 seconds**. Every shot below was verified live in a real browser (headless Chromium via Playwright, zero console/page errors) before this list was finalized — see `SUBMISSION_READINESS.md`.

## Setup (before recording, not part of the timed recording)

1. **Reset state.** ActionHarbor's demo backend (`apps/server`) holds all runs in memory with no persistence — restarting the process *is* the reset mechanism; no separate reset script exists or is needed. Do not reuse a long-running server process from a prior take.
   ```bash
   pnpm --filter @actionharbor/server start          # terminal 1 — fresh in-memory state every launch
   pnpm --filter @actionharbor/web dev                # terminal 2
   ```
2. Open the printed Vite URL in a **clean browser window/profile** — no other tabs, no extensions with visible icons/badges, notifications muted, no bookmarks bar clutter, window sized to roughly 1440×900 so nothing wraps awkwardly.
3. Do a **silent dry run** of every click below immediately before recording, to warm caches and confirm nothing has drifted.

## Shot-by-shot (single continuous take, one scenario run)

| Time | Shot | Action | What's on screen |
|---|---|---|---|
| 0:00–0:10 | Title / cold open | No app interaction — narration only, or a static title card. | — |
| 0:10–0:25 | Proposal | Load the app. Click **B. Approval path**. | Run Control Room appears; **Proposal** panel shows the raw/validated tabs, the exact `send_customer_message` parameters, and the plan hash. |
| 0:25–0:40 | Policy decision | (no click — already visible) | **Policy decision** panel: `REQUIRE_APPROVAL`, reason code `EXTERNAL_COMMUNICATION`. State badge top-right reads "Approval required." |
| 0:40–0:55 | Human approval boundary | Click **Approve exact proposal**. | **Approval** panel showed the exact action/plan hash *before* the click; after, state badge flips to "Verified," Approval panel shows approver, scope, consumed status. |
| 0:55–0:70 | Capability-constrained execution | (no click) | **Capability** panel: scope, resource, expiry, status — *no raw token or nonce anywhere on screen*. **Execution** panel: "Succeeded," "Adapter calls (real, counted): 1," the real adapter receipt JSON. |
| 0:70–0:85 | Postcondition verification | (no click) | **Verification** panel: Precondition "Passed," Postcondition "Passed," shown as *independent, separate checks* — not inferred from the receipt alone. |
| 0:85–1:00 | Replay / idempotency | Click **Replay same operation**. | Adapter call count stays at **1** (unchanged). Verification panel now also shows reason code `IDEMPOTENT_REPLAY`. |
| 1:00–1:15 | Tamper-evident audit timeline | Scroll to **Audit timeline**. Click **Try tampering (sandbox copy)**. | The 6-row server-authored event trail (`MODEL_PROPOSAL_RECORDED` → `POLICY_DECISION` → `APPROVAL_CONSUMED` → `CAPABILITY_MINTED` → `EXECUTION_STARTED` → `POSTCONDITION_VERIFIED`), then the red "Sandbox copy FAILED integrity: HASH_MISMATCH" banner appears — the REAL ledger is explicitly noted as untouched. |
| 1:15–1:20 | Closing line | No interaction. | Hold on the audit timeline. |

## Optional B-roll (only if under time budget allows a few extra seconds, or for a longer cut)

- **A. Blocked action**: click it fresh, show `DENIED` with `MISSING_FINANCE_ROLE` + `HIGH_IMPACT`, and "Adapter calls: 0" — proves a bad proposal never reaches a capability at all.
- **D. Stale approval**: click it, then **Simulate resource drift**, then **Approve** — shows `STALE`, reason codes `PRECONDITION_FAILED` + `RESOURCE_VERSION_CHANGED`, adapter calls still 0.
- **E. Unknown outcome**: click it, show the `UNKNOWN_OUTCOME` state and its "what cannot happen" callout ("NEVER be silently retried..."), then **Reconcile** after a few seconds to show it resolve to `VERIFIED` / `RECONCILED_SUCCESS`.

These three are NOT in the core 90–120s cut — they were chosen out because the core cut already demonstrates denial-adjacent safety (via the approval boundary) and idempotency (via replay); adding all five scenarios would not fit the time budget without rushing.

## Closing line (spoken over the final held frame)

> "The model proposes. ActionHarbor decides whether anything is allowed to happen."

## Recording constraints

- No fabricated narration audio — narration is a script for a human to read live (`NARRATION.md`), not synthesized.
- No production architecture changes were made for recording purposes — the "reset" is simply restarting an already-in-memory-only server process, which is how the demo backend has worked since Gate 9.
- No terminal windows, debug consoles, or notification popups should appear in frame. Two terminal windows are needed to *start* the servers but should be closed or minimized before the recording begins.
