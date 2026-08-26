import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTING_CASE_IDS } from "./professional-skill-routing-profile.js";
import { DOMAIN_SKILLS } from "./professional-skills-profile.js";

const repositoryRoot = process.cwd();
const readiness = readFileSync(join(repositoryRoot, "docs/M3_READINESS.md"), "utf8");
const sentinel = readFileSync(
  join(repositoryRoot, "packages/eval/src/gates/m3-readiness.ts"),
  "utf8",
);

describe("M3 readiness record", () => {
  it("lists the exact common evidence classifications", () => {
    for (const classification of [
      "passed",
      "model_limit",
      "product_failure",
      "runtime_failure",
      "environment_blocked",
      "harness_failure",
    ]) {
      expect(readiness).toContain(`\`${classification}\``);
    }
  });

  it("keeps each professional domain skill pending on both platforms", () => {
    for (const skill of DOMAIN_SKILLS) {
      expect(readiness).toContain(`| \`${skill}\` chain | macOS, pending candidate`);
      expect(readiness).toContain(`| \`${skill}\` chain | Windows, pending candidate`);
    }
    for (const id of ROUTING_CASE_IDS) {
      expect(readiness).toContain(`| \`${id}\` negative routing | macOS, pending candidate`);
      expect(readiness).toContain(`| \`${id}\` negative routing | Windows, pending candidate`);
    }
    expect(readiness).not.toContain("macOS and Windows, pending candidate");
  });

  it("keeps the one-clean-run policy and the intentional sentinel", () => {
    expect(readiness).toContain("One clean complete run on the candidate build is sufficient");
    expect(readiness).toContain("Runtime code does not parse this Markdown file");
    expect(sentinel).toContain("throw new Error");
    expect(sentinel).toContain("docs/M3_READINESS.md");
    expect(sentinel).not.toContain("readFile");
  });
});
