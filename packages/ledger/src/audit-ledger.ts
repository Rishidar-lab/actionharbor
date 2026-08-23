import type { AuditLedgerEntry } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { type AuditEventInput, buildLedgerEntry, GENESIS_HASH } from "./hash-chain.js";

/**
 * The append-only authoritative audit store (Gate 8; ARCHITECTURE.md:
 * "the evidence zone is write-only from application paths"). This class
 * has exactly one way to add data — `append` — and no method that
 * updates, deletes, replaces, or reorders an existing entry. That is not
 * an access-control check that could be bypassed; there is simply no
 * such method on the type, so "ordinary application APIs must not expose
 * UPDATE/DELETE" is a compile-time fact about this class's surface, not
 * a runtime guard.
 *
 * `list()`/`findByOperation()`/`findByRun()` all return a frozen,
 * independently-allocated copy of the underlying array — mutating (or
 * even attempting to `.push()` onto, which throws under `Object.freeze`)
 * a returned array can never reach back into the ledger's own state.
 */
export class AuditLedger {
  private readonly entries: AuditLedgerEntry[] = [];

  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  append(input: AuditEventInput): AuditLedgerEntry {
    const sequence = this.entries.length + 1;
    const last = this.entries.at(-1);
    const prevHash = last === undefined ? GENESIS_HASH : last.hash;
    const entry = buildLedgerEntry(input, sequence, prevHash, this.idGenerator, this.clock);
    this.entries.push(entry);
    return entry;
  }

  list(): readonly AuditLedgerEntry[] {
    return Object.freeze([...this.entries]);
  }

  findByOperation(operationId: string): readonly AuditLedgerEntry[] {
    return Object.freeze(this.entries.filter((entry) => entry.operationId === operationId));
  }

  findByRun(runId: string): readonly AuditLedgerEntry[] {
    return Object.freeze(this.entries.filter((entry) => entry.runId === runId));
  }
}
