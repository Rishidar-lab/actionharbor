import type { Capability, CapabilityRequest } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { parseAndValidateCapability, validateCapability } from "./capability.js";

const NOW = new Date("2026-08-22T09:00:00Z");

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_000001",
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    expiresAt: "2026-08-22T09:05:00Z",
    nonce: "nonce-1",
    status: "active",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    principalId: "principal-1",
    actionType: "create_internal_ticket",
    resourceId: "incident-1",
    proposalHash: "hash-abc",
    ...overrides,
  };
}

describe("validateCapability", () => {
  it("accepts an active, unexpired, exactly-scoped capability", () => {
    const result = validateCapability(makeCapability(), makeRequest(), NOW);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a consumed capability with CAPABILITY_STATUS_INVALID", () => {
    const result = validateCapability(
      makeCapability({ status: "consumed" }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_STATUS_INVALID" });
  });

  it("rejects a revoked capability with CAPABILITY_STATUS_INVALID", () => {
    const result = validateCapability(
      makeCapability({ status: "revoked" }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_STATUS_INVALID" });
  });

  it("rejects a capability whose TTL has elapsed with CAPABILITY_EXPIRED", () => {
    const result = validateCapability(
      makeCapability({ expiresAt: "2026-08-22T08:59:59Z" }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_EXPIRED" });
  });

  it("treats expiresAt exactly equal to now as expired (no grace window)", () => {
    const result = validateCapability(
      makeCapability({ expiresAt: NOW.toISOString() }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_EXPIRED" });
  });

  it("rejects a resource-id mismatch (capability minted for a different order) with CAPABILITY_SCOPE_MISMATCH", () => {
    const result = validateCapability(
      makeCapability({ resourceId: "order-1" }),
      makeRequest({ resourceId: "order-2" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
  });

  it("rejects a principal-id mismatch with CAPABILITY_SCOPE_MISMATCH", () => {
    const result = validateCapability(
      makeCapability(),
      makeRequest({ principalId: "someone-else" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
  });

  it("rejects an action-type mismatch with CAPABILITY_SCOPE_MISMATCH", () => {
    const result = validateCapability(
      makeCapability({ actionType: "create_internal_ticket" }),
      makeRequest({ actionType: "issue_refund" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
  });

  it("rejects a proposal-hash mismatch (plan changed since minting) with CAPABILITY_SCOPE_MISMATCH", () => {
    const result = validateCapability(
      makeCapability({ proposalHash: "h1" }),
      makeRequest({ proposalHash: "h2" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_SCOPE_MISMATCH" });
  });

  it("checks status before expiry before scope, so the first-listed problem is always the reported reason", () => {
    const result = validateCapability(
      makeCapability({ status: "revoked", expiresAt: "2000-01-01T00:00:00Z", resourceId: "wrong" }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_STATUS_INVALID" });
  });

  it("Gate 6: an unparseable expiresAt fails closed as CAPABILITY_EXPIRED rather than silently passing (NaN <= x is always false in JS)", () => {
    const result = validateCapability(
      makeCapability({ expiresAt: "not-a-date" as unknown as Capability["expiresAt"] }),
      makeRequest(),
      NOW,
    );
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_EXPIRED" });
  });
});

describe("parseAndValidateCapability", () => {
  it("accepts a well-formed, matching capability and returns the parsed object", () => {
    const result = parseAndValidateCapability(makeCapability(), makeRequest(), NOW);
    expect(result).toEqual({ ok: true, capability: makeCapability() });
  });

  it("rejects a completely wrong shape as CAPABILITY_MALFORMED", () => {
    const result = parseAndValidateCapability({ foo: "bar" }, makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_MALFORMED" });
  });

  it("rejects null/undefined as CAPABILITY_MALFORMED, never throwing", () => {
    expect(parseAndValidateCapability(null, makeRequest(), NOW)).toEqual({ ok: false, reasonCode: "CAPABILITY_MALFORMED" });
    expect(parseAndValidateCapability(undefined, makeRequest(), NOW)).toEqual({ ok: false, reasonCode: "CAPABILITY_MALFORMED" });
  });

  it("rejects a capability with an extra, unrecognized field (schema is .strict())", () => {
    const result = parseAndValidateCapability({ ...makeCapability(), extra: "smuggled" }, makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_MALFORMED" });
  });

  it("rejects a capability whose expiresAt is not a real ISO datetime string as CAPABILITY_MALFORMED (caught before validateCapability even runs)", () => {
    const result = parseAndValidateCapability({ ...makeCapability(), expiresAt: "not-a-date" }, makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_MALFORMED" });
  });

  it("still applies validateCapability's checks once parsing succeeds (e.g. an expired-but-well-formed capability)", () => {
    const result = parseAndValidateCapability(makeCapability({ expiresAt: "2000-01-01T00:00:00Z" }), makeRequest(), NOW);
    expect(result).toEqual({ ok: false, reasonCode: "CAPABILITY_EXPIRED" });
  });
});
