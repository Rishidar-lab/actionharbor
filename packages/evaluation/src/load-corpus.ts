import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const CORPUS_DIR = fileURLToPath(new URL("../corpus", import.meta.url));

const CorpusCase = z
  .object({
    case_id: z.string(),
    category: z.string(),
    title: z.string(),
    input: z.record(z.string(), z.unknown()),
    expected: z
      .object({
        terminal_state: z.string(),
        reason_codes: z.array(z.string()),
        required_audit_events: z.array(z.string()),
        human_required: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type CorpusCase = z.infer<typeof CorpusCase>;

const CorpusFile = z
  .object({
    dataset: z.string(),
    schema_version: z.string(),
    generated_at: z.string(),
    cases: z.array(CorpusCase),
  })
  .strict();
export type CorpusFile = z.infer<typeof CorpusFile>;

function loadCorpusFile(filename: string): CorpusFile {
  const raw = readFileSync(`${CORPUS_DIR}/${filename}`, "utf8");
  return CorpusFile.parse(JSON.parse(raw));
}

export interface FourCorpora {
  readonly adversarial: CorpusFile;
  readonly policy: CorpusFile;
  readonly toolValidation: CorpusFile;
  readonly approval: CorpusFile;
}

/**
 * IMPLEMENTATION_SEQUENCE.md Gate 10: "four JSON corpora and harness."
 * Loads all four, verbatim from `corpus/` (never hand-edited), and asserts
 * the structural relationship actually present in the frozen dataset:
 * `policy_cases.json`, `tool_validation_cases.json`, and
 * `approval_cases.json` are each a category-filtered SUBSET of
 * `adversarial_cases.json`'s 24 cases (verified by exact case_id set
 * comparison, not assumed) — so the 24-case corpus is the authoritative
 * union, and the other three let per-category results be reported without
 * re-deriving them.
 */
export function loadFourCorpora(): FourCorpora {
  const adversarial = loadCorpusFile("adversarial_cases.json");
  const policy = loadCorpusFile("policy_cases.json");
  const toolValidation = loadCorpusFile("tool_validation_cases.json");
  const approval = loadCorpusFile("approval_cases.json");

  const adversarialIds = new Set(adversarial.cases.map((c) => c.case_id));
  for (const [name, file] of [
    ["policy_cases.json", policy],
    ["tool_validation_cases.json", toolValidation],
    ["approval_cases.json", approval],
  ] as const) {
    for (const c of file.cases) {
      if (!adversarialIds.has(c.case_id)) {
        throw new Error(`loadFourCorpora: ${name} contains case_id "${c.case_id}" not present in adversarial_cases.json — corpora are no longer consistent subsets`);
      }
    }
  }

  return { adversarial, policy, toolValidation, approval };
}
