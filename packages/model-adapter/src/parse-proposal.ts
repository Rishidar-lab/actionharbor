import type { ProposalRejectionReason, RawAction } from "@actionharbor/contracts";
import { RawProposalEnvelope } from "@actionharbor/contracts";

interface MinimalZodIssue {
  readonly code: string;
  readonly path: ReadonlyArray<PropertyKey>;
}

/** TECHNICAL_SPEC.md operational limit: "proposal size ≤64 KiB". Checked before JSON.parse so an oversized payload is never even parsed. */
const MAX_PROPOSAL_BYTES = 64 * 1024;

const LENGTH_BOUNDED_PARAMETER_FIELDS = new Set(["title", "description", "body", "reason"]);

/**
 * Turns one `z.ZodError` into the single most useful reason code
 * (ADVERSARIAL_PLAN.md's evaluation cases each expect exactly one).
 * `unrecognized_keys` — parameter smuggling (w3-004) — is checked first
 * because an extra field is the most security-relevant failure available
 * and should never be masked by an unrelated missing/invalid field in the
 * same payload.
 */
function mapZodErrorToReasonCode(issues: readonly MinimalZodIssue[]): ProposalRejectionReason {
  if (issues.some((issue) => issue.code === "unrecognized_keys")) {
    return "UNKNOWN_FIELD";
  }

  if (issues.some((issue) => issue.path.includes("amountMinorInteger"))) {
    return "INVALID_AMOUNT";
  }

  const hasOversizedBoundedField = issues.some((issue) => {
    if (issue.code !== "too_big") return false;
    const lastSegment = issue.path[issue.path.length - 1];
    return typeof lastSegment === "string" && LENGTH_BOUNDED_PARAMETER_FIELDS.has(lastSegment);
  });
  if (hasOversizedBoundedField) {
    return "PARAMETER_TOO_LARGE";
  }

  return "INVALID_PROPOSAL";
}

export type ProposalParseResult =
  | { readonly ok: true; readonly actions: readonly RawAction[] }
  | { readonly ok: false; readonly reasonCode: ProposalRejectionReason; readonly details: string };

/**
 * The ONLY function permitted to turn a model adapter's raw bytes into
 * something structurally trustworthy enough to reach policy
 * (ARCHITECTURE.md: "Model output ... [is a] separate module and separate
 * state transition"). Never receives credentials, never returns an
 * `ActionProposal` with a server-assigned id or canonical hash — only the
 * validated `RawAction[]` a caller still has to turn into real proposals.
 *
 * Three failure layers, checked in this order because each earlier one
 * makes the next meaningless: size limit (cheap, avoids parsing a huge
 * malicious payload) -> JSON syntax -> schema shape.
 */
export function parseModelProposal(raw: string): ProposalParseResult {
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_PROPOSAL_BYTES) {
    return {
      ok: false,
      reasonCode: "PROPOSAL_TOO_LARGE",
      details: `proposal is ${byteLength} bytes; limit is ${MAX_PROPOSAL_BYTES}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reasonCode: "MALFORMED_PROPOSAL",
      details: error instanceof Error ? error.message : "invalid JSON",
    };
  }

  const result = RawProposalEnvelope.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reasonCode: mapZodErrorToReasonCode(result.error.issues), details: result.error.message };
  }

  return { ok: true, actions: result.data.actions };
}
