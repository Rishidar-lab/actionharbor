# ActionHarbor

**Intent is not permission.**

A model may propose an action. It cannot authorize one. This repository is
under active gate-by-gate construction per `IMPLEMENTATION_SEQUENCE.md` in the
frozen Week 3 specification; see that document (outside this repo) for the
full product, architecture, and threat model. This README will be replaced
with `README_DRAFT.md` content at Gate 11 once the commands and claims below
have code behind every one of them.

## Status: Gate 0 — repository skeleton and the capability boundary

What exists right now:

- A pnpm/TypeScript strict monorepo (`packages/contracts`, `packages/domain`,
  `packages/gateway`).
- The `Capability` contract (`packages/contracts`) — the only runtime
  authority an adapter call may present.
- A deterministic `Clock` and `IdGenerator` abstraction (`packages/domain`) so
  expiry/TTL logic is testable without racing the real clock.
- The pure, deterministic capability validation boundary
  (`packages/domain/src/capability.ts`).
- The adapter boundary contract and the action gateway
  (`packages/gateway`) — the only function in this codebase permitted to call
  `adapter.execute`.
- The first proven security invariant: **no adapter call without a valid
  capability**, checked against a real `vi.fn()` spy at the adapter boundary,
  not a hand-rolled counter.

Everything else — policy, proposals, approvals, execution/idempotency,
verification, audit, the frontend, and the adversarial evaluation harness —
is out of scope until its own gate.

## Commands

```bash
pnpm install     # install workspace dependencies
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit, per package
pnpm test        # vitest run, whole workspace
pnpm build       # per-package build (no-op until a package needs bundling)
pnpm audit       # dependency vulnerability audit
pnpm secret-scan # zero-dependency scan of git-tracked files
```

No command above requires network access or an API key. There is no live
model or live adapter in this repository yet.
