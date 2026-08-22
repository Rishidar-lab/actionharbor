import { createHash } from "node:crypto";
import type { ActionType } from "@actionharbor/contracts";

export type Canonical = null | boolean | string | number | readonly Canonical[] | { readonly [key: string]: Canonical };

/**
 * Canonicalisation (DOMAIN_MODEL.md): "sorts object keys, normalises numbers
 * and timestamps, rejects NaN/unknown fields." This walks arbitrary JSON-ish
 * input and produces a structure whose `JSON.stringify` output is stable
 * regardless of the key order the caller happened to build it in — the
 * property that makes hashing deterministic across two independently
 * constructed but logically identical proposals.
 *
 * Throws on anything that would make the hash ambiguous or silently lossy:
 * `undefined`, non-finite numbers (`NaN`, `Infinity`), and any value that
 * isn't plain JSON data (functions, symbols, bigints, class instances).
 */
export function canonicalize(value: unknown): Canonical {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number is not hashable (${String(value)})`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sortedKeys = Object.keys(input).sort();
    const result: Record<string, Canonical> = {};
    for (const key of sortedKeys) {
      const propertyValue = input[key];
      if (propertyValue === undefined) {
        throw new TypeError(`canonicalize: field "${key}" is undefined; omit it explicitly instead`);
      }
      result[key] = canonicalize(propertyValue);
    }
    return result;
  }

  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

function sha256Hex(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}

/** Deterministic hash of any canonicalizable value. Used for both proposal and audit-event hashing. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

export interface ProposalHashInput {
  readonly schemaVersion: string;
  readonly actionType: ActionType;
  readonly resourceId: string;
  readonly parameters: Record<string, unknown>;
  readonly evidenceRefs: readonly string[];
}

/**
 * The canonical plan hash (DOMAIN_MODEL.md): "hashes the versioned action
 * schema plus proposal payload. Any material change creates a new hash and
 * invalidates prior approval/capability."
 *
 * Deliberately excludes `principalId`/`actionType`/`resourceId` from being
 * the ONLY defence — those are already checked as independent exact-match
 * fields at the capability boundary (Gate 0). What this hash exists to pin
 * down is the exact *plan*: which parameters and which evidence a human
 * approved. `evidenceRefs` is sorted before hashing because the set of
 * evidence is what's material, not the order it was listed in; adding or
 * removing a reference changes the hash, reordering does not.
 */
export function computeProposalHash(input: ProposalHashInput): string {
  return hashCanonical({
    schemaVersion: input.schemaVersion,
    actionType: input.actionType,
    resourceId: input.resourceId,
    parameters: input.parameters,
    evidenceRefs: [...input.evidenceRefs].sort(),
  });
}
