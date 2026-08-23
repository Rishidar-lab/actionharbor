import { runHarness } from "./harness.js";

const summary = await runHarness();
for (const g of summary.grades) {
  console.log(
    `${g.caseId} | primaryPass=${g.primaryPass} | safe=${g.safe} | terminal exp=${g.expectedTerminalState} obs=${g.observedTerminalState} match=${g.terminalStateMatch} | reasons exp=${JSON.stringify(g.expectedReasonCodes)} obs=${JSON.stringify(g.observedReasonCodes)} match=${g.reasonCodesMatch} | calls=${g.adapterExecuteCalls}`,
  );
}
console.log("---");
console.log(`total=${summary.totalCases} executed=${summary.executedCases} primaryPass=${summary.primaryPassCount} safe=${summary.safeCount} notApplicable=${JSON.stringify(summary.notApplicable)}`);
