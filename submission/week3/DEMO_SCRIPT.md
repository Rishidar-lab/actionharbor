# ActionHarbor — Demo Script

Target duration: **90–120 seconds**. Combines narration and on-screen action into a single timed table — read alongside `FINAL_RECORDING_SHOTLIST.md` (shots) and `NARRATION.md` (narration text alone, for rehearsal).

| Time | On screen | Say |
|---|---|---|
| 0:00–0:10 | Title / cold open | "LLMs can propose actions. The problem is that a proposal is not the same thing as authority to act — and most agent frameworks quietly treat it as if it were." |
| 0:10–0:25 | Click **B. Approval path**. Proposal panel appears. | "This is ActionHarbor. The model just proposed sending a customer a message — here's the exact, untrusted proposal it returned, before anything downstream has decided anything." |
| 0:25–0:40 | Policy decision panel visible. | "A deterministic policy engine — not the model — decides what happens next. This action requires human approval, and it says exactly why: external communication." |
| 0:40–0:55 | Click **Approve exact proposal**. | "A human approves the *exact* action — bound to this specific plan hash. Only after that does a capability get minted. The model was never in a position to grant itself this." |
| 0:55–0:70 | Capability + Execution panels visible. | "The capability that authorizes execution is scoped, short-lived, and shown here with no raw token exposed. The adapter ran exactly once — that's a real, counted call, not a claim." |
| 0:70–0:85 | Verification panel visible. | "Success isn't assumed from an 'OK' response. Precondition and postcondition are checked independently — both have to actually pass." |
| 0:85–1:00 | Click **Replay same operation**. | "If the same operation is submitted again — a network retry, a duplicate call — the adapter is not invoked a second time. Same receipt, same result, zero extra side effects." |
| 1:00–1:15 | Scroll to audit timeline. Click **Try tampering**. | "Every one of those steps is recorded in a hash-chained, server-authored audit trail. Edit a single past event — even in a sandbox copy — and the chain visibly breaks." |
| 1:15–1:20 | Hold on the broken-chain banner. | "The model proposes. ActionHarbor decides whether anything is allowed to happen." |

## Delivery notes

- Speak at a natural, unhurried pace — the table's time budget already assumes normal speech, not a rushed read.
- Pause briefly (silently) after each UI state change resolves before speaking the next line, so the viewer's eye has a moment to land on what changed.
- If running long, cut from the end inward: the closing line and the tamper demo must stay; the verification-panel beat (0:70–0:85) is the safest one to shorten if needed, since the postcondition/precondition badges are already visible in the execution shot.
