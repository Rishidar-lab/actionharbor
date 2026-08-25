# Week 3 LinkedIn Post — Final Draft (ActionHarbor)

**Status: content final, grounded only in claims the frozen implementation
actually supports** (`submission/week3/WEEK3_FREEZE.md`,
`submission/week3/SUBMISSION_READINESS.md`). The demo video is now real
and public (GitHub Release `week3-demo-v1`); the resulting LinkedIn post
URL is the one remaining placeholder — it cannot exist until this is
actually published.

---

**Approval is not a button.**

For Innovation Hacks Week 3, I built **ActionHarbor** — a policy-enforced
action gateway that only lets an AI proposal become a real side effect
when authorization, human approval where required, and independent
postcondition verification all succeed.

Most "human-in-the-loop" systems treat approval as a single click that
unlocks whatever the model does next. That's not a safety boundary — if
the plan or evidence changes after the click but before execution, a
stale "yes" can authorize something the human never saw. So in
ActionHarbor, approval isn't a flag. It's bound to the exact plan hash,
evidence state, and action being authorized, and re-checked at the moment
of use, not just the moment of granting.

**AI proposes. Policy decides. Human approval authorizes where required.
Capabilities constrain execution. Deterministic verification proves
outcomes. A tamper-evident audit ledger records the lifecycle.**

A model can propose an action. It cannot set the policy decision, mint its
own execution capability, or declare an outcome "verified" — all produced
exclusively by deterministic server code. Execution authority is
capability-scoped, single-use, and re-validated immediately before the
adapter call. A resolved call isn't "success" until an independent
postcondition check proves it; an ambiguous outcome fails closed instead
of being guessed at.

The recorded demo shows this live: an approved action executes and gets
verified, and a live tamper attempt against the audit ledger is caught by
the hash-chain check on screen.

Evaluated against a 24-case adversarial corpus: **24/24 safe** (zero
illegitimate adapter side effects), **24/24 exact-match** on terminal
state and reason codes — one gap (a replay/idempotency reason code) was a
real issue I found and fixed, documented rather than hidden.

No live LLM integration is used — proposals come from a deterministic fake
model, by design, since this build demonstrates *system* safety, not
model quality.

GitHub: https://github.com/Rishidar-lab/actionharbor
Demo video: https://github.com/Rishidar-lab/actionharbor/releases/tag/week3-demo-v1

#InnovationHacks #AIEngineering #AgentSafety #Governance

---

## Publishing checklist (do not skip)

- [x] **CI is passing** on `main` — the prior `pnpm typecheck` failure (`Cannot find module 'zod'` in `packages/evaluation`, which imported zod directly without declaring it as a dependency) was fixed by declaring `zod` as a direct dependency, and verified green in live GitHub Actions runs, most recently at commit `21f03b1`.
- [x] Local `main` and `origin/main` match — nothing outstanding to push at the time of writing.
- [x] Recorded the demo per `DEMO_SCRIPT.md` / `FINAL_RECORDING_SHOTLIST.md` / `NARRATION.md` — real Playwright capture of the live app (Scenario B), local TTS narration, burned-in captions. Published as GitHub Release `week3-demo-v1`.
- [x] Replaced the demo-video placeholder with the real, publicly-verified release URL above.
- [ ] Do not claim live LLM integration, production readiness, or a tamper-*proof* (vs. tamper-*evident*) ledger — all explicitly disclaimed in the README and freeze doc.
- [ ] Do not publish while any link above is still a placeholder. (Only the resulting LinkedIn post URL remains — it cannot exist before publication.)
- [ ] Record the resulting post URL in `submission/FINAL_SUBMISSION_MATRIX.md` once published.
