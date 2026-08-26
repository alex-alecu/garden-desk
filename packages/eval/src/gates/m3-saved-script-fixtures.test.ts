import { describe, expect, it } from "vitest";
import {
  macosSavedScriptRequirement,
  windowsSavedScriptRequirement,
} from "./m3-saved-script-fixtures.js";

function expectSharedArtifactWrite(input: {
  brokenSource: string;
  failure: string;
  repairedSource: string;
  statements: string[];
}): void {
  for (const statement of input.statements) {
    expect(input.brokenSource).toContain(statement);
    expect(input.repairedSource).toContain(statement);
  }
  expect(input.brokenSource.indexOf(input.failure)).toBeGreaterThan(
    input.brokenSource.indexOf(input.statements.at(-1) ?? ""),
  );
}

describe("saved-script physical gate fixtures", () => {
  it("writes the same Python artifact bytes before failure and after repair", () => {
    const requirement = macosSavedScriptRequirement("python");

    expectSharedArtifactWrite({
      brokenSource: requirement.brokenSource,
      failure: 'raise RuntimeError("repair-needed")',
      repairedSource: requirement.repairedSource,
      statements: [
        'value = Path("/source/python-input.txt").read_text()',
        'Path("/workspace/python-result.txt").write_text(value)',
      ],
    });
  });

  it("writes the same Node artifact bytes before failure and after repair", () => {
    const requirement = macosSavedScriptRequirement("node");

    expectSharedArtifactWrite({
      brokenSource: requirement.brokenSource,
      failure: 'throw new Error("repair-needed");',
      repairedSource: requirement.repairedSource,
      statements: [
        'const value = await readFile("/source/node-input.txt", "utf8");',
        'await writeFile("/workspace/node-result.txt", value);',
      ],
    });
  });

  it("writes the same Windows artifact bytes before failure and after repair", () => {
    const requirement = windowsSavedScriptRequirement;

    expectSharedArtifactWrite({
      brokenSource: requirement.brokenSource,
      failure: 'raise RuntimeError("repair-needed")',
      repairedSource: requirement.repairedSource,
      statements: [
        'value = "windows-saved-repair"',
        'Path("/workspace/windows-saved-repair.txt").write_text(value)',
      ],
    });
  });
});
