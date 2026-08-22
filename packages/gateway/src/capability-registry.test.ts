import type { Capability } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./capability-registry.js";

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap_1",
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

describe("CapabilityRegistry", () => {
  it("consumes a recorded capability successfully when id and nonce both match", () => {
    const registry = new CapabilityRegistry();
    const capability = makeCapability();
    registry.record(capability);
    expect(registry.consume(capability.id, capability.nonce)).toEqual({ ok: true });
  });

  it("THE key hand-rolled-capability defence: a capability id never record()ed is CAPABILITY_UNKNOWN, however well-formed", () => {
    const registry = new CapabilityRegistry();
    // Never called registry.record() — this simulates an attacker (or a
    // model) hand-constructing a perfectly-shaped Capability object.
    const forged = makeCapability({ id: "cap_never_minted" });
    expect(registry.consume(forged.id, forged.nonce)).toEqual({ ok: false, reasonCode: "CAPABILITY_UNKNOWN" });
  });

  it("a correct id with the wrong nonce is CAPABILITY_NONCE_MISMATCH — knowing the id alone is not enough", () => {
    const registry = new CapabilityRegistry();
    const capability = makeCapability();
    registry.record(capability);
    expect(registry.consume(capability.id, "guessed-nonce")).toEqual({ ok: false, reasonCode: "CAPABILITY_NONCE_MISMATCH" });
  });

  it("single-use: consuming the same capability twice fails the second time with CAPABILITY_ALREADY_CONSUMED", () => {
    const registry = new CapabilityRegistry();
    const capability = makeCapability();
    registry.record(capability);
    expect(registry.consume(capability.id, capability.nonce)).toEqual({ ok: true });
    expect(registry.consume(capability.id, capability.nonce)).toEqual({ ok: false, reasonCode: "CAPABILITY_ALREADY_CONSUMED" });
  });

  it("consuming a capability that was recorded with a non-active status fails immediately, without ever reporting ok:true", () => {
    const registry = new CapabilityRegistry();
    const revoked = makeCapability({ status: "revoked" });
    registry.record(revoked);
    expect(registry.consume(revoked.id, revoked.nonce)).toEqual({ ok: false, reasonCode: "CAPABILITY_ALREADY_CONSUMED" });
  });

  it("has() reflects registration regardless of consumption state", () => {
    const registry = new CapabilityRegistry();
    const capability = makeCapability();
    expect(registry.has(capability.id)).toBe(false);
    registry.record(capability);
    expect(registry.has(capability.id)).toBe(true);
    registry.consume(capability.id, capability.nonce);
    expect(registry.has(capability.id)).toBe(true);
  });

  it("two different capabilities with different ids are tracked independently", () => {
    const registry = new CapabilityRegistry();
    const a = makeCapability({ id: "cap_a", nonce: "nonce_a" });
    const b = makeCapability({ id: "cap_b", nonce: "nonce_b" });
    registry.record(a);
    registry.record(b);
    expect(registry.consume(a.id, a.nonce)).toEqual({ ok: true });
    expect(registry.consume(b.id, b.nonce)).toEqual({ ok: true });
  });
});
