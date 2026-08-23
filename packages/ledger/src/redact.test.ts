import { describe, expect, it } from "vitest";
import { redactPayload, redactValue, REDACTED } from "./redact.js";

describe("redactValue — key-name detection", () => {
  it.each([
    ["apiKey", "sk-live-abcdef1234567890"],
    ["api_key", "sk-live-abcdef1234567890"],
    ["password", "hunter2"],
    ["dbPassword", "hunter2"],
    ["token", "raw-token-value"],
    ["accessToken", "raw-token-value"],
    ["bearerToken", "raw-token-value"],
    ["credential", "raw-credential-value"],
    ["clientCredentials", "raw-credential-value"],
    ["authorization", "Basic dXNlcjpwYXNz"],
    // Deliberately NOT shaped like a real PEM header or AWS access key id —
    // this test is about KEY-NAME detection, not value realism, and a
    // realistic-looking fixture here would itself trip scripts/secret-scan.mjs.
    ["privateKey", "FAKE-TEST-KEY-MATERIAL-NOT-REAL-PEM"],
    ["accessKey", "FAKE-TEST-ACCESS-KEY-NOT-REAL-AKIA-STYLE"],
  ])("redacts value for secret-shaped key %s", (key, value) => {
    expect(redactValue(key, value)).toBe(REDACTED);
  });

  it.each([
    ["operationId", "op_000001"],
    ["capabilityId", "cap_000001"],
    ["proposalHash", "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567"],
    ["idempotencyKey", "key-1"],
    ["resourceId", "incident-1"],
    ["title", "Cold-chain check"],
  ])("does NOT redact non-secret key %s", (key, value) => {
    expect(redactValue(key, value)).toBe(value);
  });
});

describe("redactValue — value-shape detection under an innocuous key", () => {
  it("redacts a Bearer-prefixed value even under a harmless key name", () => {
    expect(redactValue("note", "Bearer abc123.def456-ghi789")).toBe(REDACTED);
  });

  it("redacts a JWT-shaped value even under a harmless key name", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactValue("comment", jwt)).toBe(REDACTED);
  });

  it("does not redact an ordinary sha256 hash under a harmless key name", () => {
    const hash = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    expect(redactValue("planHash", hash)).toBe(hash);
  });

  it("does not redact an ordinary long uuid-shaped identifier", () => {
    const uuid = "3f9c9c1e-2b7a-4e2c-9c1a-0a2b3c4d5e6f";
    expect(redactValue("traceId", uuid)).toBe(uuid);
  });
});

describe("redactPayload — recursion", () => {
  it("redacts secret-shaped keys nested inside objects", () => {
    const payload = { request: { headers: { authorization: "Bearer secret-token-value" } } };
    expect(redactPayload(payload)).toEqual({ request: { headers: { authorization: REDACTED } } });
  });

  it("redacts secret-shaped values inside arrays", () => {
    const payload = { notes: ["fine", "Bearer abc.def-ghi"] };
    expect(redactPayload(payload)).toEqual({ notes: ["fine", REDACTED] });
  });

  it("leaves a fully non-secret payload untouched", () => {
    const payload = { outcome: "REQUIRE_APPROVAL", reasonCodes: ["HIGH_IMPACT"], resourceVersion: 1 };
    expect(redactPayload(payload)).toEqual(payload);
  });
});
