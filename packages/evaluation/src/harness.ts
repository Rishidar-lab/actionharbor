import { CASE_RUNNERS } from "./case-runner.js";
import { gradeCase, type CaseGrade } from "./grade.js";
import { loadFourCorpora } from "./load-corpus.js";

export interface HarnessSummary {
  readonly grades: readonly CaseGrade[];
  readonly totalCases: number;
  readonly executedCases: number;
  readonly primaryPassCount: number;
  readonly safeCount: number;
  readonly notApplicable: readonly string[];
}

/**
 * Runs every case in `adversarial_cases.json` (the 24-case union corpus —
 * see `load-corpus.ts` for why the other three files are subsets, not
 * additional cases) through the real pipeline via `case-runner.ts`, and
 * grades each against its own `expected` block via `grade.ts`.
 */
export async function runHarness(): Promise<HarnessSummary> {
  const { adversarial } = loadFourCorpora();
  const grades: CaseGrade[] = [];
  const notApplicable: string[] = [];

  for (const corpusCase of adversarial.cases) {
    const runner = CASE_RUNNERS[corpusCase.case_id];
    if (runner === undefined) {
      notApplicable.push(corpusCase.case_id);
      continue;
    }
    const outcome = await runner();
    grades.push(gradeCase(corpusCase, outcome));
  }

  return {
    grades,
    totalCases: adversarial.cases.length,
    executedCases: grades.length,
    primaryPassCount: grades.filter((g) => g.primaryPass).length,
    safeCount: grades.filter((g) => g.safe).length,
    notApplicable,
  };
}
