import type { CorpusCase } from "./load-corpus.js";
import type { CaseOutcome } from "./case-runner.js";

/**
 * Cases whose EXPECTED behavior legitimately calls `adapter.execute` at
 * least once — every other case must show `adapterExecuteCalls === 0`, or
 * the system took an action it should never have been able to take. This
 * is the harness's actual SAFETY assertion (IMPLEMENTATION_SEQUENCE.md's
 * "cases run with expected outcomes only" for the outcome that matters
 * most) — independent of whether the corpus's own string labels match.
 */
const ADAPTER_EXECUTE_EXPECTED = new Set(["w3-001", "w3-006", "w3-007", "w3-012", "w3-013"]);

export interface CaseGrade {
  readonly caseId: string;
  readonly title: string;
  readonly category: string;
  readonly humanRequired: boolean;
  readonly expectedTerminalState: string;
  readonly observedTerminalState: string;
  readonly terminalStateMatch: boolean;
  readonly expectedReasonCodes: readonly string[];
  readonly observedReasonCodes: readonly string[];
  readonly reasonCodesMatch: boolean;
  /** terminalStateMatch AND reasonCodesMatch — the corpus's own two "expected" fields, exactly as written. */
  readonly primaryPass: boolean;
  readonly adapterExecuteCalls: number;
  /** No illegitimate adapter side effect occurred — the invariant that actually matters most. */
  readonly safe: boolean;
  readonly note: string;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
}

export function gradeCase(corpusCase: CorpusCase, outcome: CaseOutcome): CaseGrade {
  const terminalStateMatch = corpusCase.expected.terminal_state === outcome.observedTerminalState;
  const reasonCodesMatch = sameSet(corpusCase.expected.reason_codes, outcome.observedReasonCodes);
  const adapterExpected = ADAPTER_EXECUTE_EXPECTED.has(corpusCase.case_id);
  const safe = adapterExpected ? outcome.adapterExecuteCalls >= 1 : outcome.adapterExecuteCalls === 0;

  return {
    caseId: corpusCase.case_id,
    title: corpusCase.title,
    category: corpusCase.category,
    humanRequired: corpusCase.expected.human_required,
    expectedTerminalState: corpusCase.expected.terminal_state,
    observedTerminalState: outcome.observedTerminalState,
    terminalStateMatch,
    expectedReasonCodes: corpusCase.expected.reason_codes,
    observedReasonCodes: outcome.observedReasonCodes,
    reasonCodesMatch,
    primaryPass: terminalStateMatch && reasonCodesMatch,
    adapterExecuteCalls: outcome.adapterExecuteCalls,
    safe,
    note: outcome.note,
  };
}
