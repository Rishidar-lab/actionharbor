# ActionHarbor — Week 3 Submission Readiness

## Live-browser verification performed

Every state referenced in `DEMO_SCRIPT.md` / `FINAL_RECORDING_SHOTLIST.md` was driven and observed in a **real browser** (headless Chromium via Playwright, pointed at the actual running `apps/server` + `apps/web` dev stack — not a mock, not a static fixture) before this document was signed off:

| State / action | Verified | Evidence |
|---|---|---|
| Proposal (raw/validated tabs) | ✅ | `docs/screenshots/01-proposal.png` |
| Policy decision (`REQUIRE_APPROVAL`) | ✅ | `docs/screenshots/02-policy-decision.png` |
| Approval (pre-approve, exact plan hash shown) | ✅ | `docs/screenshots/03-approval.png` |
| Capability + Execution (post-approve, `Succeeded`, 1 real adapter call) | ✅ | `docs/screenshots/04-execution-verification.png` |
| Verification (precondition/postcondition both `Passed`) | ✅ | `docs/screenshots/04-execution-verification.png` |
| Audit timeline (6-event server-authored trail) | ✅ | `docs/screenshots/05-audit-timeline.png` |
| Denied action (`DENIED`, 0 adapter calls) | ✅ | `docs/screenshots/06-denied-action.png` |
| Unknown outcome (`UNKNOWN_OUTCOME` state banner) | ✅ | `docs/screenshots/07-unknown-outcome.png` |
| Replay (adapter calls stays at 1, `IDEMPOTENT_REPLAY` reason code appears) | ✅ | live run, zero console/page errors |
| Audit tampering sandbox (`HASH_MISMATCH` banner, real ledger explicitly untouched) | ✅ | live run, zero console/page errors |
| Responsive layout at 1440 / 1024 / 768 / 390px (no horizontal overflow at any width; sidebar `position: sticky` confirmed correct under real scroll, not just a static capture) | ✅ | Gate 9 verification pass |

No console errors, no page errors, and no visible secrets, environment values, or debug overlays were observed in any of the above.

## Setup used for verification (identical to recording setup)

```bash
pnpm --filter @actionharbor/server start   # fresh in-memory state on every launch
pnpm --filter @actionharbor/web dev
```

No API key, no network access, and no external account was needed for any of the above — the model is a deterministic `FakeModelAdapter` and every adapter is a real, stateful, in-memory fake.

## Known, disclosed caveats (none are blockers)

- **w3-006 evaluation history**: originally 23/24 on the Gate 10 evaluation corpus; investigated per explicit instruction (checked `TECHNICAL_SPEC.md`, `API_SPEC.md`, `ERROR_MODEL.md`, `DOMAIN_MODEL.md` — none define the corpus's `IDEMPOTENT_REPLAY` term, while `API_SPEC.md` names this exact outcome family `duplicate_operation`); resolved as a genuine implementation gap, not a corpus error, by adding a real `IDEMPOTENT_REPLAY` reason code and `DUPLICATE_REPLAY_DETECTED` audit event. Now **24/24**. See `README.md` §9 and commit `ed9e9ce`.
- **Audit ledger is tamper-evident, not tamper-proof.** Stated explicitly in `README.md` §8 and demonstrated live in the recording — this is a deliberate, accurate claim, not a limitation being hidden.
- **No live LLM integration.** All 24 evaluation cases and all 5 demo scenarios run against a deterministic fake model. This is disclosed in `README.md` §9 and §14 ("Non-Goals") rather than implied away.
- **No production persistence.** `apps/server`'s state is in-memory only; this is exactly what makes "restart the process" a legitimate, already-existing reset mechanism for repeatable recording takes — see `README.md` and this document's setup section.

## Full verification suite (must be green before recording and before any push)

```bash
pnpm test        # 379 tests total (374 root + 5 frontend-only)
pnpm typecheck   # 11 packages
pnpm lint
pnpm build       # apps/web production build
pnpm audit
pnpm secret-scan
git diff --check
```

## Sign-off

- [x] Every screen in the shot list rendered correctly in a real browser.
- [x] Zero console/page errors across every verified flow.
- [x] No secrets, environment values, personal information, or localhost debug clutter visible in any captured screenshot.
- [x] Full verification suite green at the commit this document was written against.
- [x] Evaluation results reported truthfully (24/24, with the w3-006 history disclosed, not concealed).

**READY TO RECORD.**
