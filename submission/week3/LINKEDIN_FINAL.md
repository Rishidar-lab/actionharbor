# Week 3 LinkedIn Post — Final Draft (ActionHarbor)

**Status: content final, grounded only in claims the frozen implementation
actually supports** (`submission/week3/WEEK3_FREEZE.md`,
`submission/week3/SUBMISSION_READINESS.md`). Two links are placeholders —
fill only when real, do not guess them.

---

**Approval is not a button.**

For Innovation Hacks Week 3, I built **ActionHarbor** — a policy-enforced
action gateway that only lets an AI proposal become a real side effect
when authorization, human approval where required, and independent
postcondition verification all succeed.

The design question I kept coming back to: most "human-in-the-loop"
systems treat approval as a single yes/no click that unlocks whatever the
model wants to do next. That's not actually a safety boundary — if the
plan, the evidence, or the action changes after the click but before
execution, a stale "yes" can authorize something the human never actually
saw. So in ActionHarbor, an approval isn't a flag. It's bound to the exact
plan hash, evidence state, and action being authorized — and it's
re-checked at the moment of use, not just at the moment of granting.

**AI proposes. Policy decides. Human approval authorizes where required.
Capabilities constrain execution. Deterministic verification proves
outcomes. A tamper-evident audit ledger records the lifecycle.**

- A model can propose an action. It cannot set the policy decision, mint
  its own execution capability, invoke an adapter directly, declare an
  outcome "verified," or author an audit event — every one of those is
  produced exclusively by deterministic server code.
- Execution authority is capability-scoped and single-use, re-validated
  against current state immediately before the adapter call — not just
  checked once, upstream.
- A resolved adapter call is not treated as success until an independent
  postcondition check proves it; an ambiguous outcome fails closed
  (`UNKNOWN_OUTCOME`) instead of being guessed at or silently retried.
- Every step is recorded in a hash-chained audit ledger — tamper-evident,
  verified live in the demo by actually attempting a tamper and watching
  the chain check catch it.

Evaluated against a 24-case adversarial corpus: **24/24** match the
expected terminal state and reason codes, and **24/24** are safe — zero
illegitimate adapter side effects across the entire corpus. That safety
result is unconditional; the exact-match result is the stricter, harder
bar, and one case (a replay/idempotency reason-code gap) was a genuine,
disclosed implementation gap I found and fixed rather than a corpus
error — documented, not hidden.

No live LLM integration is used — proposals come from a deterministic fake
model, by design, because everything this build demonstrates is *system*
safety, not model quality. That boundary is stated explicitly, not implied
away.

GitHub: https://github.com/Rishidar-lab/actionharbor
Demo video: **[ADD DEMO VIDEO URL AFTER UPLOAD]**

#InnovationHacks #AIEngineering #AgentSafety #TypeScript #Governance
**[ADD OFFICIAL INNOVATION HACKS TAG/HANDLE/URL IF the program specifies one beyond the hashtag]**

---

## Publishing checklist (do not skip)

- [x] **CI is passing** on `main` (commit `49a80fd`) — the prior `pnpm typecheck` failure (`Cannot find module 'zod'` in `packages/evaluation`, which imported zod directly without declaring it as a dependency) has been fixed by declaring `zod` as a direct dependency, and verified green in a live GitHub Actions run, not just locally.
- [x] Local `main` and `origin/main` match exactly at `49a80fd` — nothing outstanding to push.
- [ ] Record the demo per `DEMO_SCRIPT.md` / `FINAL_RECORDING_SHOTLIST.md` / `NARRATION.md` — all three are complete and marked "ready to record"; no recording exists yet.
- [ ] Replace the demo-video placeholder with the real upload URL — never guess it.
- [ ] Do not claim live LLM integration, production readiness, or a tamper-*proof* (vs. tamper-*evident*) ledger — all explicitly disclaimed in the README and freeze doc.
- [ ] Do not publish while any link above is still a placeholder.
- [ ] Record the resulting post URL in `submission/FINAL_SUBMISSION_MATRIX.md` once published.
