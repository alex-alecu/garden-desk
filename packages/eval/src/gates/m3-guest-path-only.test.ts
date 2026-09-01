import type { AgentExecutionResult } from "@gardendesk/shared";
import type { AgentSessionExecution, CodeAgentSession } from "@gardendesk/workers";
import { describe, expect, it } from "vitest";
import { requirePathOnlyScript } from "./m3-guest.js";

function session(resolvedSource: string, exitCode = 0) {
  const requests: AgentSessionExecution[] = [];
  const value: CodeAgentSession = {
    async execute(request): Promise<AgentExecutionResult> {
      requests.push(request);
      if (request.language === "shell") throw new Error("unexpected_shell");
      return {
        language: request.language,
        path: request.path,
        source: resolvedSource,
        command: null,
        exitCode,
        stdout: "passed\n",
        stderr: "",
        durationMs: 1,
        termination: exitCode === 0 ? "completed" : "crash",
        artifacts: [],
      };
    },
    async cancel(): Promise<void> {},
    async close(): Promise<void> {},
  };
  return { requests, value };
}

describe("direct path-only proof", () => {
  it.each([
    ["python", "steps/repair.py", "print('repaired')\n"],
    ["node", "steps/probe.mjs", "console.log('passed');\n"],
  ] as const)("runs %s source through a path-only request", async (language, path, source) => {
    const fake = session(source);

    await requirePathOnlyScript(fake.value, { language, path, source });

    expect(fake.requests).toEqual([{ language, path }]);
  });

  it("rejects a result that does not record the committed source", async () => {
    const fake = session("print('other bytes')\n");

    await expect(
      requirePathOnlyScript(fake.value, {
        language: "python",
        path: "steps/repair.py",
        source: "print('repaired')\n",
      }),
    ).rejects.toThrow();
  });

  it("rejects an unsuccessful path-only execution", async () => {
    const fake = session("print('repaired')\n", 1);

    await expect(
      requirePathOnlyScript(fake.value, {
        language: "python",
        path: "steps/repair.py",
        source: "print('repaired')\n",
      }),
    ).rejects.toThrow();
  });
});
