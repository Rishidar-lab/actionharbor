# ControlDeck (Week 4) — Requirements

This document separates confirmed/frozen requirements from unknowns, exactly like ActionHarbor's own `00-program/OFFICIAL_REQUIREMENTS.md` did for Week 3. **No unsupported claim is presented as a requirement.**

## Source priority (as instructed, in order)

1. Official Week-4 challenge/internship requirements — **checked, not found** (see below).
2. Frozen Week-4 specification (`AI_INTERNSHIP_W3_W4_MASTER.zip`, `05-week4/*.md` and `06-week4-evaluation/*`).
3. `submission/WEEK4_HANDOFF.md` (this project's own prior synthesis of #2).
4. Existing architecture documents (Week 3's `README.md`, `packages/*` doc comments) — for reusable *patterns* only, never as a source of Week 4 requirements.
5. Inference — used only where explicitly labelled, never silently.

## What is officially confirmed

From the frozen package's own `00-program/OFFICIAL_REQUIREMENTS.md` (sourced from the public Unstop listing for "AI Internship at Innovation Hacks"):

- The internship exists, is one month, work-from-home, part-time, four listed working days.
- Application deadline 9 Aug 2026, start 10 Aug 2026, end 10 Sep 2026 (as displayed publicly; timezone/display semantics unconfirmed).
- A certificate of completion is a listed perk.
- An official WhatsApp community is mandatory for selected interns.

**The public listing does not publish a Week 3/4 engineering rubric, task breakdown, or submission mechanics.** Per that same document's own "Reconciliation decision": *"The attached brief is therefore used as the controlling design and artifact specification for this task, while all claims about official submission rules beyond the recovered Week 1 repository are explicitly marked UNKNOWN."* This project adopts the identical stance for Week 4 that it already adopted for Week 3.

## What is frozen (the controlling specification for this build)

The entire `05-week4/*.md` set (23 documents: `PRODUCT_SPEC`, `TECHNICAL_SPEC`, `ARCHITECTURE`, `AGENT_CONTRACTS`, `ORCHESTRATION_MODEL`, `POLICY_MODEL`, `EVIDENCE_MODEL`, `AUTHORITY_MODEL`, `AUDIT_MODEL`, `STATE_MACHINE`, `API_SPEC`, `EVENT_SCHEMA`, `SECURITY_MODEL`, `THREAT_MODEL`, `UX_SPEC`, `TEST_PLAN`, `EVALUATION_PLAN`, `ADVERSARIAL_PLAN`, `DEMO_PLAN`, `README_DRAFT`, `IMPLEMENTATION_SEQUENCE`, `ACCEPTANCE_MATRIX`, `CLAUDE_BUILD_PROMPT`) plus `06-week4-evaluation/{evaluation_corpus.json, invariants.json, README.md}` (30 evaluation cases, 10 invariants).

Product one-liner (`PRODUCT_SPEC.md`): *"ControlDeck is an auditable control plane where specialist agents propose evidence-backed work, but deterministic governance controls the transition from proposal to authorised action and independently verifies outcomes."*

P0 scope: one deterministic workflow with 4-5 agents, synthetic corpus, an ActionHarbor-*pattern* gateway integration (see `ARCHITECTURE.md`'s explicit design-decision note on literal vs. conceptual reuse), explicit conflict/failure states, a replayable audit timeline, and two 90-120s demos.

## Acceptance matrix (frozen, `05-week4/ACCEPTANCE_MATRIX.md`)

| ID | Criterion | Priority |
|---|---|---|
| A1 | Every agent has a strict input/output contract | P0 |
| A2 | No agent can directly execute a tool | P0 |
| A3 | Evidence records have source/version/hash lineage | P0 |
| A4 | Critical unsupported/contradicted claim blocks action | P0 |
| A5 | Approval is bound to plan/evidence/action hashes | P0 |
| A6 | Every side effect is mediated by the execution boundary | P0 |
| A7 | No completion without postcondition verification | P0 |
| A8 | Unknown outcome is reconciled, not blindly retried | P0 |
| A9 | Audit events are server-authored and tamper-evident | P0 |
| A10 | Replay reconstructs deterministic state | P1 |
| A11 | Human can understand blocked reason within 10s | P1 |
| A12 | Demo runs offline with synthetic data | P0 |

(A6 is restated from the frozen spec's literal "ActionHarbor mediates every side effect" — see `ARCHITECTURE.md` for why this document generalizes it to "the execution boundary.")

## Rubric emphasis (OBSERVED proxy only — `00-program/RUBRIC_MATRIX.md`)

*"The strongest differentiator is not the number of agents. It is whether each agent has a non-overlapping contract and whether the control plane can reconstruct evidence, authority, state transitions, conflicts, and failures across the complete run."* No official Week 4 point values were recovered; this is retained only as a design-priority signal, not a scoring guarantee.

## UNKNOWN — REQUIRES SOURCE SPEC

Carried forward unchanged from `submission/WEEK4_HANDOFF.md` §2, plus refinements from this gate's deeper source search:

- The exact organiser-issued Week 4 task statement (whether multi-agent orchestration is actually mandatory for the real submission, vs. being this internal team's own chosen candidate architecture).
- Official Week 4 rubric and point weighting.
- Week 4 due date and final submission cutoff/timezone.
- Submission channel (GitHub / form / WhatsApp / portal).
- Whether ControlDeck is expected as part of the `actionharbor` repository or a fully separate one. **Resolved for this build** (not a spec fact, a build decision, stated plainly): ControlDeck is built as an independent repository/workspace — see `ARCHITECTURE.md` — specifically *because* the "Reuse Policy" instruction for this gate said to avoid tight coupling and avoid ControlDeck depending on ActionHarbor; this is this project's own engineering decision, not a discovered requirement.
- Whether live deployment is required.
- Data/privacy restrictions for demos (interim assumption already in force: synthetic data, no real credentials — same as ActionHarbor).

## Non-goals (frozen, `PRODUCT_SPEC.md` + `CLAUDE_BUILD_PROMPT.md`)

- No free-form agent swarm.
- No shared mutable "memory" trusted as fact.
- No agent permission to promote its own output to authoritative state.
- No claim that multiple prompts to a shared model constitute independent cognition.
- No claim that a hash chain alone makes a production-immutable ledger.
- No live deployment (until confirmed).
- No fabricated pass/fail results ever written into the source evaluation datasets.
