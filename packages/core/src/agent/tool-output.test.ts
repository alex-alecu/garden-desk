import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { boundedToolOutput } from "./tool-output.js";

function completed(source: string): AgentExecutionResult {
  return {
    language: "python",
    path: ".vault-output/write.py",
    source,
    command: null,
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function source(run: Parameters<AgentExecutor["execute"]>[0]): string {
  return run.language === "shell" ? run.command : run.source;
}

describe("bounded tool output", () => {
  it("spills oversized output and gives grep/read recovery guidance", async () => {
    const writes: string[] = [];
    const executor: AgentExecutor = {
      async inspect(run) {
        writes.push(source(run));
        return completed(source(run));
      },
      async execute(run) {
        return completed(source(run));
      },
    };
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index}`).join("\n");

    const result = await boundedToolOutput(executor, output);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("/workspace/.vault-output/");
    expect(result).toContain("[Output truncated. Full output saved to /workspace/.vault-output/");
    expect(result).toContain("Use grep or read with offset/limit.");
    expect(result).toContain("line 1999");
    expect(result).not.toContain("line 2000");
  });
});
