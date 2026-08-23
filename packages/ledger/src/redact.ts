/**
 * Deterministic redaction for ledger `payload` content only
 * (AUDIT_EVENT_SCHEMA.md: "Redaction rules prevent secrets and raw
 * credentials from entering payloads"). This is scoped narrowly on
 * purpose:
 *
 * - Structural entry fields (`eventId`, `operationId`, `runId`,
 *   `prevHash`, `hash`, and any hash/id embedded in `payload` under a
 *   non-secret-shaped key such as `payloadHash` or `capabilityId`) are
 *   evidence, not secrets, and are never passed through this module at
 *   all — only `AuditEventInput.payload` is redacted, never the entry's
 *   own identity/chain fields. Redacting those would break the hash
 *   chain's evidentiary value while contributing no real confidentiality
 *   (they are opaque identifiers, not credentials).
 * - Detection is key-name-based (a fixed deny-list of credential-shaped
 *   key names) PLUS two narrow value-shape checks (`Bearer <token>` and
 *   JWT-shaped `xxx.yyy.zzz` strings) that catch a credential landing
 *   under an innocuous key name. It deliberately does NOT redact "any
 *   long opaque string," because that would also catch our own
 *   `sha256:...` hashes and `evt_`/`op_`/`cap_` ids — the exact fields
 *   Gate 8's integrity/evidence story depends on.
 */

export const REDACTED = "[REDACTED]";

const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|credential|bearer|authorization|private[_-]?key|access[_-]?key/i;
const BEARER_VALUE_PATTERN = /^bearer\s+\S+/i;
const JWT_VALUE_PATTERN = /^eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i;

function isSecretShapedValue(value: string): boolean {
  return BEARER_VALUE_PATTERN.test(value) || JWT_VALUE_PATTERN.test(value);
}

export function redactValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_KEY_PATTERN.test(key) || isSecretShapedValue(value) ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }
  if (value !== null && typeof value === "object") {
    return redactPayload(value as Record<string, unknown>);
  }
  return value;
}

/** Applied to every `AuditEventInput.payload` before it is written into the ledger — see module doc for exactly what is and is not in scope. */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = redactValue(key, value);
  }
  return result;
}
