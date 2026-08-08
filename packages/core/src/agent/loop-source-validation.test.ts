import { describe, expect, it } from "vitest";
import { rejectedExecutionReason } from "./loop-decisions.js";

function python(source: string) {
  return { action: "execute", language: "python", source, summary: "Validate" } as const;
}

describe("agent source validation", () => {
  it("rejects a source line truncated at the structured generation boundary", () => {
    expect(rejectedExecutionReason(python(`print('done')${"0".repeat(500)}`), [])).toBe("invalid");
  });

  it("rejects an uncalled entry point", () => {
    expect(rejectedExecutionReason(python("def main():\n    print('done')"), [])).toBe("invalid");
  });
});
