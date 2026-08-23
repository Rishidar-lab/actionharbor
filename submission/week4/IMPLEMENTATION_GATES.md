# ControlDeck (Week 4) — Implementation Gates

This sequence matches this gate's own instructions almost exactly (13 gates, 0-12), which in turn matches the frozen `05-week4/IMPLEMENTATION_SEQUENCE.md`'s 13-gate sequence in substance, reworded for this build's repository-independence decision (see `ARCHITECTURE.md`). No change to the sequence was needed.

| Gate | Deliverable | Acceptance criteria |
|---|---|---|
| 0 | Requirements / threat model / architecture (this gate's docs) | Internally consistent, grounded in source requirements, unknowns explicitly marked |
| 1 | Domain schemas + state machine | Illegal transitions rejected; every transition in `ARCHITECTURE.md`'s table has a corresponding test |
| 2 | Evidence / provenance | Unverified or stale evidence cannot satisfy a "verified" requirement; CLAIM/EVIDENCE/VERIFIED-FACT stay structurally distinct types |
| 3 | Governance / policy | Composition-wide evaluation; fail-closed; no agent can shorten the authority chain |
| 4 | Multi-agent proposal adapters (Planner, Researcher, Executor contracts) | No tool or approval path from any agent; each contract independently unit-testable without a live model |
| 5 | Approval / authority | Hash-bound approval (plan+evidence+action); any material change invalidates it |
| 6 | Execution boundary / idempotency | Capability-based; no direct adapter path from any agent; idempotency enforced at the operation layer |
| 7 | Verification / reconciliation | No completion without independent postcondition re-derivation; unknown outcome resolved only via read-only lookup |
| 8 | Audit ledger | Server-authored, hash-chained, append-only; tamper detected by recomputation |
| 9 | Operator UI | Governance-timeline stage rail (not chat); every required UX state legible; topology-violation banner |
| 10 | Adversarial evaluation | Full 30-case corpus + 10-invariant × 3-test-type harness; expected-only datasets, actual traces kept separate |
| 11 | Documentation | README, threat model, acceptance matrix — reused/adapted from this Gate 0 package, not rewritten from scratch |
| 12 | Demo / release | 90-120s reproducible demo, matching `05-week4/DEMO_PLAN.md`'s script |

## This session's authorized scope

Per this gate's explicit "Fast-Lane Authorization": **Gate 1 may proceed automatically once Gate 0's documents are internally consistent; Gate 2 may proceed automatically if Gate 1 is completely green; STOP after Gate 2.** Gates 3-12 require an explicit further instruction — this is a deliberate review boundary before governance/execution authority is built, not an oversight.

## Quality bar for every gate (this session's instruction, applied identically to every gate 1-12)

- Tests written first or alongside implementation, never retrofitted after the fact.
- Reason-coded failures — no bare booleans standing in for "why."
- Negative tests for every rejection path, not just the happy path.
- Security invariants asserted against real spies/counters, never boolean flags.
- Typecheck, lint, secret scan, dependency audit — every gate, not just the last one.
- One mutation test per gate proving its central invariant actually matters (temporarily broken, confirmed red, reverted, confirmed green — mutation never committed).
- One coherent commit per gate.
- No push without explicit further instruction.
