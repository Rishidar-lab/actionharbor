import type { AuditLedgerEntry } from "@actionharbor/contracts";
import { CounterIdGenerator, FixedClock } from "@actionharbor/domain";
import { describe, expect, it } from "vitest";
import { AuditLedger } from "./audit-ledger.js";
import type { AuditEventInput } from "./hash-chain.js";
import { buildLedgerEntry, computeEntryHash } from "./hash-chain.js";
import { verifyLedgerIntegrity } from "./integrity.js";

const NOW = new Date("2026-08-23T10:00:00Z");

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: "POLICY_DECISION",
    actor: { kind: "server", id: "policy-engine-v1" },
    subject: { kind: "action", id: "act_01" },
    payload: { outcome: "ALLOW", reasonCodes: [] },
    ...overrides,
  };
}

/** A realistic 4-entry chain, built through the real ledger (not hand-constructed). */
function buildFourEntryChain(): { readonly ledger: AuditLedger; readonly entries: readonly AuditLedgerEntry[] } {
  const l = new AuditLedger(new CounterIdGenerator(), new FixedClock(NOW));
  l.append(event({ type: "MODEL_PROPOSAL_RECORDED", operationId: "op_1", payload: { goal: "open a ticket" } }));
  l.append(event({ type: "POLICY_DECISION", operationId: "op_1", payload: { outcome: "ALLOW", reasonCodes: [] } }));
  l.append(event({ type: "CAPABILITY_MINTED", operationId: "op_1", payload: { scope: "create_internal_ticket" } }));
  l.append(event({ type: "POSTCONDITION_VERIFIED", operationId: "op_1", payload: { verified: true } }));
  return { ledger: l, entries: l.list() };
}

describe("verifyLedgerIntegrity — 1. a valid, untouched ledger verifies", () => {
  it("reports ok with the full entry count", () => {
    const { entries } = buildFourEntryChain();
    expect(verifyLedgerIntegrity(entries)).toEqual({ ok: true, checkedEntries: 4 });
  });
});

describe("verifyLedgerIntegrity — 2. editing a historical event fails integrity", () => {
  it("detects a rewritten payload on an earlier (non-last) entry", () => {
    const { entries } = buildFourEntryChain();
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, payload: { outcome: "ALLOW", reasonCodes: ["FORGED"] } } : e));
    const result = verifyLedgerIntegrity(tampered);
    expect(result).toEqual({ ok: false, reasonCode: "HASH_MISMATCH", brokenAtSequence: 2 });
  });
});

describe("verifyLedgerIntegrity — 3. deleting a historical event fails integrity", () => {
  it("detects a removed earlier entry via a sequence gap", () => {
    const { entries } = buildFourEntryChain();
    const tampered = entries.filter((_, i) => i !== 1); // remove sequence 2
    const result = verifyLedgerIntegrity(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasonCode).toBe("SEQUENCE_GAP");
  });

  it("deleting the single most-recent entry is caught only when an expected count is supplied", () => {
    const { entries } = buildFourEntryChain();
    const truncated = entries.slice(0, 3);
    expect(verifyLedgerIntegrity(truncated).ok).toBe(true); // shape alone can't tell — documented limitation
    expect(verifyLedgerIntegrity(truncated, 4)).toEqual({ ok: false, reasonCode: "CHAIN_LENGTH_MISMATCH", brokenAtSequence: 4 });
  });
});

describe("verifyLedgerIntegrity — 4. reordering events fails integrity", () => {
  it("detects two entries swapped in position", () => {
    const { entries } = buildFourEntryChain();
    const [e0, e1, e2, e3] = entries;
    if (e0 === undefined || e1 === undefined || e2 === undefined || e3 === undefined) throw new Error("unreachable");
    const tampered: AuditLedgerEntry[] = [e0, e2, e1, e3];
    const result = verifyLedgerIntegrity(tampered);
    expect(result.ok).toBe(false);
  });
});

describe("verifyLedgerIntegrity — 5. altering a reason code fails integrity", () => {
  it("detects a reasonCodes change inside payload", () => {
    const { entries } = buildFourEntryChain();
    const tampered = entries.map((e, i) => (i === 1 ? { ...e, payload: { ...e.payload, reasonCodes: ["HIGH_IMPACT"] } } : e));
    const result = verifyLedgerIntegrity(tampered);
    expect(result).toEqual({ ok: false, reasonCode: "HASH_MISMATCH", brokenAtSequence: 2 });
  });
});

describe("verifyLedgerIntegrity — 6. altering operation identity fails integrity", () => {
  it("detects an operationId change", () => {
    const { entries } = buildFourEntryChain();
    const tampered = entries.map((e, i) => (i === 2 ? { ...e, operationId: "op_stolen" } : e));
    const result = verifyLedgerIntegrity(tampered);
    expect(result).toEqual({ ok: false, reasonCode: "HASH_MISMATCH", brokenAtSequence: 3 });
  });
});

describe("verifyLedgerIntegrity — 7. a forged replacement hash cannot pass without rebuilding descendants", () => {
  it("even a self-consistent forged entry is caught at the next entry's prevHash link", () => {
    const { entries } = buildFourEntryChain();
    const victim = entries[1];
    if (victim === undefined) throw new Error("unreachable");
    const { hash: _oldHash, ...withoutHash } = { ...victim, payload: { outcome: "ALLOW", reasonCodes: ["FORGED"] } };
    const forgedEntry: AuditLedgerEntry = { ...withoutHash, hash: computeEntryHash(withoutHash) };

    // The forged entry is internally self-consistent: its own hash matches its own (tampered) content.
    expect(forgedEntry.hash).toBe(computeEntryHash(withoutHash));

    const tampered = entries.map((e, i) => (i === 1 ? forgedEntry : e));
    const result = verifyLedgerIntegrity(tampered);
    // ...but descendant entry 3's prevHash still points at the ORIGINAL hash of entry 2.
    expect(result).toEqual({ ok: false, reasonCode: "PREV_HASH_MISMATCH", brokenAtSequence: 3 });
  });

  it("forging an entry AND rebuilding every descendant produces a chain that verifies — proving the guarantee is tamper-evidence, not immutability", () => {
    const { entries } = buildFourEntryChain();
    const idGenerator = new CounterIdGenerator();
    const clock = new FixedClock(NOW);

    const rebuilt: AuditLedgerEntry[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const original = entries[i];
      if (original === undefined) throw new Error("unreachable");
      const prevHash = i === 0 ? entries[0]?.prevHash : rebuilt[i - 1]?.hash;
      if (prevHash === undefined) throw new Error("unreachable");
      const input: AuditEventInput =
        i === 1
          ? { type: original.type, actor: original.actor, subject: original.subject, payload: { outcome: "ALLOW", reasonCodes: ["FORGED"] } }
          : { type: original.type, actor: original.actor, subject: original.subject, payload: original.payload };
      rebuilt.push(buildLedgerEntry(input, i + 1, prevHash, idGenerator, clock));
    }

    expect(verifyLedgerIntegrity(rebuilt).ok).toBe(true);
    // The rebuild is detectable only by comparing against an independently-held original copy —
    // which is exactly why the ledger is append-only and the ONLY writer, not proof of immutability.
    expect(rebuilt[1]?.hash).not.toBe(entries[1]?.hash);
  });
});

describe("verifyLedgerIntegrity — 8. a valid append preserves integrity", () => {
  it("appending a genuine new entry through the real ledger keeps the chain verifying", () => {
    const { ledger, entries: before } = buildFourEntryChain();
    expect(verifyLedgerIntegrity(before)).toEqual({ ok: true, checkedEntries: 4 });

    ledger.append(event({ type: "AUDIT_INTEGRITY_CHECKED", operationId: "op_1", payload: { result: "ok" } }));
    const after = ledger.list();
    expect(verifyLedgerIntegrity(after)).toEqual({ ok: true, checkedEntries: 5 });
  });
});

describe("verifyLedgerIntegrity — edge cases", () => {
  it("an empty ledger verifies trivially", () => {
    expect(verifyLedgerIntegrity([])).toEqual({ ok: true, checkedEntries: 0 });
  });

  it("a chain whose first entry does not point at GENESIS_HASH fails integrity", () => {
    const { entries } = buildFourEntryChain();
    const tampered = entries.map((e, i) => (i === 0 ? { ...e, prevHash: "sha256:not-genesis" } : e));
    const result = verifyLedgerIntegrity(tampered);
    expect(result).toEqual({ ok: false, reasonCode: "PREV_HASH_MISMATCH", brokenAtSequence: 1 });
  });
});
