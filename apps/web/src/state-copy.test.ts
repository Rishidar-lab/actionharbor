import { RunState } from "@actionharbor/contracts";
import { describe, expect, it } from "vitest";
import { AUDIT_INTEGRITY_FAILED_COPY, STATE_COPY } from "./state-copy.js";

describe("STATE_COPY", () => {
  it("has an entry for every RunState the frozen state machine defines — never falls back to an unstyled/undocumented state", () => {
    for (const state of RunState.options) {
      expect(STATE_COPY[state], `missing STATE_COPY entry for "${state}"`).toBeDefined();
    }
  });

  it("every entry has non-empty what-happened / what-cannot-happen / safe-next-action copy (UX_SPEC.md)", () => {
    for (const state of RunState.options) {
      const copy = STATE_COPY[state];
      expect(copy.whatHappened.length, state).toBeGreaterThan(0);
      expect(copy.whatCannotHappen.length, state).toBeGreaterThan(0);
      expect(copy.safeNextAction.length, state).toBeGreaterThan(0);
    }
  });

  it("no entry exists for keys outside the real RunState enum", () => {
    const validStates = new Set<string>(RunState.options);
    for (const key of Object.keys(STATE_COPY)) {
      expect(validStates.has(key), `STATE_COPY has an invented state "${key}" not in the frozen state machine`).toBe(true);
    }
  });
});

describe("AUDIT_INTEGRITY_FAILED_COPY", () => {
  it("is a distinct, danger-toned banner — never reuses a terminal RunState's copy verbatim", () => {
    expect(AUDIT_INTEGRITY_FAILED_COPY.tone).toBe("danger");
    expect(Object.values(STATE_COPY)).not.toContainEqual(AUDIT_INTEGRITY_FAILED_COPY);
  });
});
