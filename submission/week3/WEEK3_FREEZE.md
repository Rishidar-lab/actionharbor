# ActionHarbor — Week 3 Freeze

**Status: ENGINEERING FROZEN.** No further features, architecture changes, evaluation-corpus edits, security-semantics changes, or refactors are to be made against this baseline. Any further Week 3 work is recording/publication only.

## Freeze point

- **Final HEAD:** `b27b18c9bfc9ddcbbdfc5f5500da434af793d419`
- **Repository:** https://github.com/Rishidar-lab/actionharbor (public)
- **Default branch:** `main`
- **Date/time of freeze:** 2026-08-23, 18:52 IST (immediately following verified push; `local HEAD == origin/main`)

## Test result

**379 / 379 engineering tests passing** (374 from the root `vitest run` across all 9 backend/domain packages + `apps/server`, plus 5 React-component tests that run only under `apps/web`'s own jsdom-configured test runner; `state-copy.test.ts`'s 4 tests are counted once, not twice, since they run under both configs).

- Typecheck: clean across all 11 packages
- Lint: clean
- Build: clean (`apps/web` production build)
- Package audit: clean
- Secret scan: clean (157 tracked files)
- `git diff --check`: clean

## Evaluation result

**24 / 24** cases from the frozen adversarial evaluation corpus (`packages/evaluation/corpus/adversarial_cases.json`) match exactly on `terminal_state` and `reason_codes`, and **24 / 24** are safe (zero illegitimate adapter side effects across the entire corpus). This includes the resolved w3-006 case (`packages/evaluation/src/harness.test.ts` records the investigation: the frozen prose spec never defined the corpus's `IDEMPOTENT_REPLAY` term, `API_SPEC.md` names the same outcome `duplicate_operation`, and the implementation — not the corpus — was incomplete; fixed in commit `ed9e9ce`).

## Security invariants (each backed by a named, real test)

| Invariant | Status |
|---|---|
| Model can authorize | NO |
| Model can self-approve | NO |
| Model can mint a capability | NO |
| Model can bypass the gateway | NO |
| Model can declare execution success | NO |
| Model can author an authoritative audit event | NO |
| Stale approval blocked | YES |
| Duplicate side effect prevented | YES |
| Unknown outcome fails closed | YES |
| Ledger tampering detected | YES |

## Demo readiness

`submission/week3/SUBMISSION_READINESS.md` is signed off: every state in the recording plan (`FINAL_RECORDING_SHOTLIST.md`) was driven and observed in a real, headless-Chromium browser against the actual running `apps/server` + `apps/web` stack, with zero console/page errors, before this freeze. `DEMO_SCRIPT.md` and `NARRATION.md` are complete and ready for a human to record against — no narration audio has been synthesized, per instruction. **READY TO RECORD.**

## Known limitations (disclosed, not blockers)

- No live LLM integration anywhere in this repository — the model is a deterministic `FakeModelAdapter`; all 24 evaluation cases and all 5 demo scenarios exercise system *safety*, not model *quality* (`README.md` §9, §14).
- The audit ledger is tamper-*evident* (hash-chain recomputation catches edits/deletes/reorders), not tamper-*proof* — it is an in-memory, per-run structure with no update/delete/replace method on its type, not an externally-witnessed or cryptographically-immutable store (`README.md` §8).
- `checkRetryBudget` (`packages/gateway/src/retry-budget.ts`) is a tested, standalone primitive matching `TECHNICAL_SPEC.md`'s stated retry limits; it is not wired into an orchestration retry loop, because no such loop exists in this codebase.
- `apps/server` is in-memory only, by design — restarting the process is the (already-existing, no-new-code) reset mechanism for repeatable demo takes.
- Two harmless, pre-existing test-fixture strings shaped like a PEM private-key header and an AWS access-key ID exist in git history (superseded at HEAD); neither is a real credential — see the Phase 3 pre-push scan performed before this freeze's push.

## What "frozen" means going forward

- No new features.
- No architecture redesign.
- No evaluation-corpus edits.
- No security-semantics changes.
- No refactors of working code.
- No speculative cleanup.

Any further commits against this repository before the recording is made should be strictly limited to this freeze document and, if genuinely necessary, narrowly-scoped documentation fixes — never code behavior.
