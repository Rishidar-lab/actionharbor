# Security

## Scope

ActionHarbor is a portfolio/demonstration project. It runs fully offline, has no live LLM integration, no real credentials, no real payment rails, and every "tool" it calls is an in-memory synthetic fake (see `README.md` §14, "Threat Model / Non-Goals"). There is no production deployment and no real user data anywhere in this repository.

## Reporting a vulnerability

If you find a security issue in the design or implementation (not in a third-party dependency — see below), please open a GitHub issue describing it. There is no bug bounty; this is unpaid, unfunded portfolio work.

## Threat model

The full threat/control matrix (16 threats: prompt injection, tool injection, schema bypass, replay, stale approval/TOCTOU, confused deputy, credential exposure, unsafe retries, audit tampering, malicious parameters, approval races, privilege escalation, partial failure, unbounded retry, and more) lives in the frozen Week-3 specification's `THREAT_MODEL.md`. `README.md` §5 and §14 summarize the invariants actually proven by this codebase's tests and state plainly what is out of scope.

## Supply-chain / dependency-confusion assumption

This is a pnpm workspace monorepo with internal packages scoped under `@actionharbor/*` (`contracts`, `domain`, `policy`, `model-adapter`, `adapters`, `gateway`, `verifier`, `ledger`, `evaluation`) plus two apps (`server`, `web`). Because npm scopes are a shared global namespace, it is worth stating explicitly what prevents a misconfigured or compromised install from resolving one of these names to a same-named package on the public npm registry instead of the real workspace source:

1. **Every internal cross-package dependency uses the `workspace:*` protocol**, never a bare semver range. Verified directly (not assumed): every `@actionharbor/*` entry in every `package.json` in this repository is declared as `"workspace:*"`. pnpm's `workspace:` protocol is a hard constraint — if the named package is not present in the workspace, `pnpm install` fails outright; it does **not** fall back to querying the public registry. A `pnpm-lock.yaml` entry for a `workspace:*` dependency likewise pins to the local package, not a registry tarball.
2. **Every package in this repository, including the root, is `"private": true`.** `npm publish` / `pnpm publish` refuse to publish a private package. None of these names have ever been published to the public npm registry from this repository, and nothing in the build or install process attempts to.
3. **No `.npmrc` file exists anywhere in this repository** that could redirect package resolution to a non-default or scoped registry, add a registry auth token, or otherwise change where these names resolve from.
4. **No dependency in this repository is installed by a bare, unscoped name that collides with a common typosquatting target** — direct dependencies are limited to well-known, actively maintained packages (React, Vite, TypeScript, Vitest, Zod, Testing Library, tsx) with no unnecessary additions.

Net effect: an attacker cannot achieve dependency confusion against this repository by publishing malicious packages under the `@actionharbor` npm scope, because nothing in this repository's install or build process would ever resolve to them. This repository does **not** publish placeholder packages to "reserve" the scope — that would itself be an unnecessary, unrequested action with its own (small) maintenance and trust surface, and it is not what actually provides the protection above.

## Secret handling

`scripts/secret-scan.mjs` runs in CI on every push and PR (`.github/workflows/ci.yml`) and scans every git-tracked file for private-key blocks, Anthropic/OpenAI-shaped API keys, AWS access key IDs, Slack tokens, and forbidden `.env`-shaped filenames. `.env.example` documents the one optional, never-required variable (`ANTHROPIC_API_KEY`, read only if a real model adapter is wired up in a later phase — not used anywhere in the current codebase) and contains no real value.
