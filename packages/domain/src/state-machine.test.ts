import type { RunState, RunStateTrigger } from "@actionharbor/contracts";
import { RunState as RunStateSchema, RunStateTrigger as RunStateTriggerSchema } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { availableTriggers, isTerminal, transition } from "./state-machine.js";

const ALL_STATES = RunStateSchema.options;
const ALL_TRIGGERS = RunStateTriggerSchema.options;

describe("transition — legal edges from STATE_MACHINE.md", () => {
  const legalEdges: ReadonlyArray<readonly [RunState, RunStateTrigger, RunState]> = [
    ["PROPOSED", "schema_pass", "VALIDATED"],
    ["PROPOSED", "schema_fail", "REJECTED"],
    ["VALIDATED", "policy_deny", "DENIED"],
    ["VALIDATED", "high_risk", "APPROVAL_REQUIRED"],
    ["VALIDATED", "low_risk_policy_allow", "AUTHORIZED"],
    ["APPROVAL_REQUIRED", "matching_approval", "AUTHORIZED"],
    ["APPROVAL_REQUIRED", "ttl_elapsed", "EXPIRED"],
    ["AUTHORIZED", "fresh_preconditions", "EXECUTING"],
    ["AUTHORIZED", "plan_or_resource_changed", "STALE"],
    ["EXECUTING", "postcondition_pass", "VERIFIED"],
    ["EXECUTING", "deterministic_tool_failure", "FAILED"],
    ["EXECUTING", "timeout_transport_ambiguity", "UNKNOWN_OUTCOME"],
    ["UNKNOWN_OUTCOME", "lookup_confirms_success", "VERIFIED"],
    ["UNKNOWN_OUTCOME", "lookup_confirms_failure", "FAILED"],
    ["UNKNOWN_OUTCOME", "lookup_inconclusive", "RECONCILIATION_REQUIRED"],
  ];

  it.each(legalEdges)("%s --%s--> %s", (from, trigger, to) => {
    expect(transition(from, trigger)).toEqual({ ok: true, nextState: to });
  });
});

describe("transition — every (state, trigger) pair not in the table is rejected", () => {
  it("rejects every pair the table does not explicitly define", () => {
    for (const state of ALL_STATES) {
      for (const trigger of ALL_TRIGGERS) {
        const result = transition(state, trigger);
        const isDeclaredEdge =
          (state === "PROPOSED" && (trigger === "schema_pass" || trigger === "schema_fail")) ||
          (state === "VALIDATED" &&
            (trigger === "policy_deny" || trigger === "high_risk" || trigger === "low_risk_policy_allow")) ||
          (state === "APPROVAL_REQUIRED" &&
            (trigger === "matching_approval" ||
              trigger === "ttl_elapsed" ||
              trigger === "capability_revoked" ||
              trigger === "concurrent_approval_conflict")) ||
          (state === "AUTHORIZED" &&
            (trigger === "fresh_preconditions" ||
              trigger === "plan_or_resource_changed" ||
              trigger === "capability_revoked")) ||
          (state === "EXECUTING" &&
            (trigger === "postcondition_pass" ||
              trigger === "deterministic_tool_failure" ||
              trigger === "timeout_transport_ambiguity")) ||
          (state === "UNKNOWN_OUTCOME" &&
            (trigger === "lookup_confirms_success" ||
              trigger === "lookup_confirms_failure" ||
              trigger === "lookup_inconclusive"));

        if (isDeclaredEdge) {
          expect(result.ok).toBe(true);
        } else {
          expect(result).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
        }
      }
    }
  });
});

describe("invariant: DENIED, EXPIRED, and REVOKED cannot execute", () => {
  it.each(["DENIED", "EXPIRED", "REVOKED"] as const)("%s has no transition to EXECUTING", (state) => {
    expect(transition(state, "fresh_preconditions")).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it.each(["DENIED", "EXPIRED", "REVOKED"] as const)("%s is terminal", (state) => {
    expect(isTerminal(state)).toBe(true);
  });
});

describe("invariant: AUTHORIZED is never terminal", () => {
  it("AUTHORIZED always has at least one outgoing transition", () => {
    expect(isTerminal("AUTHORIZED")).toBe(false);
    expect(availableTriggers("AUTHORIZED").length).toBeGreaterThan(0);
  });
});

describe("invariant: VERIFIED requires an independent postcondition check", () => {
  it("the only states with an edge into VERIFIED are EXECUTING and UNKNOWN_OUTCOME", () => {
    const sourcesReachingVerified = ALL_STATES.filter((state) =>
      ALL_TRIGGERS.some((trigger) => {
        const result = transition(state, trigger);
        return result.ok && result.nextState === "VERIFIED";
      }),
    );
    expect(new Set(sourcesReachingVerified)).toEqual(new Set(["EXECUTING", "UNKNOWN_OUTCOME"]));
  });

  it("no state reaches VERIFIED directly from AUTHORIZED, APPROVAL_REQUIRED, VALIDATED, or PROPOSED", () => {
    for (const state of ["AUTHORIZED", "APPROVAL_REQUIRED", "VALIDATED", "PROPOSED"] as const) {
      for (const trigger of ALL_TRIGGERS) {
        const result = transition(state, trigger);
        if (result.ok) {
          expect(result.nextState).not.toBe("VERIFIED");
        }
      }
    }
  });
});

describe("invariant: UNKNOWN_OUTCOME is not retryable by model regeneration", () => {
  it("the only triggers out of UNKNOWN_OUTCOME are the three lookup outcomes", () => {
    expect(new Set(availableTriggers("UNKNOWN_OUTCOME"))).toEqual(
      new Set(["lookup_confirms_success", "lookup_confirms_failure", "lookup_inconclusive"]),
    );
  });

  it("there is no trigger that sends UNKNOWN_OUTCOME back to EXECUTING or PROPOSED", () => {
    for (const trigger of ALL_TRIGGERS) {
      const result = transition("UNKNOWN_OUTCOME", trigger);
      if (result.ok) {
        expect(result.nextState).not.toBe("EXECUTING");
        expect(result.nextState).not.toBe("PROPOSED");
      }
    }
  });
});

describe("invariant: STALE requires a new proposal and policy decision", () => {
  it("STALE has zero outgoing transitions in this run's state machine", () => {
    expect(isTerminal("STALE")).toBe(true);
    expect(availableTriggers("STALE")).toEqual([]);
  });
});

describe("availableTriggers", () => {
  it("matches exactly the keys transition() accepts for that state", () => {
    for (const state of ALL_STATES) {
      for (const trigger of availableTriggers(state)) {
        expect(transition(state, trigger).ok).toBe(true);
      }
    }
  });
});
