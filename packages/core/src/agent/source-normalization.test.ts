import { describe, expect, it } from "vitest";
import { removeUnusedSourceLines } from "./source-normalization.js";

const rule = {
  line: "from unavailable.module import MissingHelper",
  identifier: "MissingHelper",
};

describe("execution source normalization", () => {
  it("removes a known unavailable import when it is unused", () => {
    const decision = removeUnusedSourceLines(
      {
        action: "execute",
        language: "python",
        source: `${rule.line}\nprint('ok')`,
        summary: "Run",
      },
      [rule],
    );
    expect(decision).toMatchObject({ source: "print('ok')" });
  });

  it("keeps a known unavailable import when the source tries to use it", () => {
    const source = `${rule.line}\nprint(${rule.identifier})`;
    expect(
      removeUnusedSourceLines({ action: "execute", language: "python", source, summary: "Run" }, [
        rule,
      ]),
    ).toMatchObject({ source });
  });
});
