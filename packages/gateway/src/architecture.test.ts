import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The structural half of "the model must never be able to invoke the
 * privileged adapter directly" (see execution.ts's documented residual
 * limitation: JS/TS cannot make a public method truly unreachable to
 * another importer in the SAME package). What IS true, and what this test
 * proves rather than asserts: nothing in the model-facing packages
 * (`contracts`, `policy`, `model-adapter`) declares `@actionharbor/gateway`
 * or `@actionharbor/adapters` as a dependency AT ALL — in a pnpm workspace
 * this is not just a convention, it is enforced by module resolution
 * itself (pnpm's node_modules is strict/isolated: a package can only
 * `import` from what it explicitly depends on). Verified empirically
 * during development: attempting `import("@actionharbor/adapters")` from
 * inside `packages/model-adapter` throws `ERR_MODULE_NOT_FOUND`, even
 * though `@actionharbor/adapters` is installed elsewhere in the same
 * workspace.
 *
 * This is what makes "the model cannot mint a capability, cannot construct
 * an accepted capability, cannot invoke the privileged adapter directly"
 * true in THIS system's real threat model: the model's entire reachable
 * code graph (`parseModelProposal`, `FakeModelAdapter`, `evaluatePolicy`)
 * has no path — not a discouraged one, an ABSENT one — to any adapter
 * instance or to `executeAction`.
 */

const PACKAGES_DIR = fileURLToPath(new URL("../../", import.meta.url));

const FORBIDDEN_DEPENDENCIES = ["@actionharbor/gateway", "@actionharbor/adapters"];

function readDependencies(packageName: string): string[] {
  const pkg = JSON.parse(readFileSync(`${PACKAGES_DIR}${packageName}/package.json`, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
}

describe("architecture: no model-facing package can reach the execution boundary", () => {
  it.each(["contracts", "policy", "model-adapter"])(
    "%s declares no dependency on @actionharbor/gateway or @actionharbor/adapters",
    (packageName) => {
      const dependencies = readDependencies(packageName);
      for (const forbidden of FORBIDDEN_DEPENDENCIES) {
        expect(dependencies).not.toContain(forbidden);
      }
    },
  );

  it("contracts (the package every other package depends on) has zero @actionharbor dependencies of its own — it cannot reach anything", () => {
    const dependencies = readDependencies("contracts").filter((d) => d.startsWith("@actionharbor/"));
    expect(dependencies).toEqual([]);
  });

  it("sanity check: adapters DOES legitimately depend on gateway (so the isolation above is a real boundary, not an accident of nothing depending on anything)", () => {
    expect(readDependencies("adapters")).toContain("@actionharbor/gateway");
  });
});
