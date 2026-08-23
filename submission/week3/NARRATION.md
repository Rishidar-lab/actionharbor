# ActionHarbor — Narration (spoken text only)

For rehearsal and timing practice. This is a script for a human to read live during recording — **no synthesized/fabricated narration audio is used**. Cross-reference `DEMO_SCRIPT.md` for which on-screen action pairs with each line.

---

**[0:00–0:10]**
LLMs can propose actions. The problem is that a proposal is not the same thing as authority to act — and most agent frameworks quietly treat it as if it were.

**[0:10–0:25]**
This is ActionHarbor. The model just proposed sending a customer a message — here's the exact, untrusted proposal it returned, before anything downstream has decided anything.

**[0:25–0:40]**
A deterministic policy engine — not the model — decides what happens next. This action requires human approval, and it says exactly why: external communication.

**[0:40–0:55]**
A human approves the *exact* action — bound to this specific plan hash. Only after that does a capability get minted. The model was never in a position to grant itself this.

**[0:55–0:70]**
The capability that authorizes execution is scoped, short-lived, and shown here with no raw token exposed. The adapter ran exactly once — that's a real, counted call, not a claim.

**[0:70–0:85]**
Success isn't assumed from an "OK" response. Precondition and postcondition are checked independently — both have to actually pass.

**[0:85–1:00]**
If the same operation is submitted again — a network retry, a duplicate call — the adapter is not invoked a second time. Same receipt, same result, zero extra side effects.

**[1:00–1:15]**
Every one of those steps is recorded in a hash-chained, server-authored audit trail. Edit a single past event — even in a sandbox copy — and the chain visibly breaks.

**[1:15–1:20]**
The model proposes. ActionHarbor decides whether anything is allowed to happen.

---

**Word count:** ~195 words. At a natural, unhurried ~140–150 words/minute speaking pace, this reads in roughly 78–84 seconds, leaving comfortable slack against the 90–120s target for pauses between beats and the cold-open/closing hold.
