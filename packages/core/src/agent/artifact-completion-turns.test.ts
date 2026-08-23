import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { missingArtifactRecovery } from "./artifact-completion.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

const RESERVED_COMPLETION_REQUEST = 37;

function output(name: string) {
  return {
    name,
    mediaType: "application/octet-stream",
    bytesBase64: Buffer.from(name).toString("base64"),
  };
}

function executor(outputs: string[][]) {
  return {
    async execute(run: Parameters<typeof source>[0]) {
      return { ...execution(source(run)), artifacts: (outputs.shift() ?? []).map(output) };
    },
  };
}

function progressTurns() {
  return Array.from({ length: RESERVED_COMPLETION_REQUEST }, (_, index) =>
    generated("", [
      tool("task", `work-${index}`, {
        description: "Continue work.",
        prompt: "Continue the task.",
        subagent_type: "explore",
      }),
    ]),
  );
}

function loopResults(results: ReturnType<typeof generated>[]) {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  return { loop: new ChatAgentLoop(model(results, requests)), requests };
}

function nearLimitInput(outputs: string[][], task = "Create result.unknown.") {
  const request = input(executor(outputs), ["python", "task"], {
    task,
    spawnTask: async () => "Work continued.",
  });
  request.agent = { ...request.agent, steps: 40 };
  return request;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused near-limit cases share one turn fixture.
describe("required artifact turn reserve", () => {
  it("uses a tool-free completion turn, a recovery turn, and a tool-free final turn", async () => {
    const { loop, requests } = loopResults([
      ...progressTurns(),
      generated("First answer."),
      generated("", [tool("python", "recover", { source: "print('result')" })]),
      generated("Finished."),
    ]);

    const result = await loop.run(nearLimitInput([["result.unknown"]]));

    expect(result.response).toBe("Finished.");
    expect(requests).toHaveLength(40);
    expect(requests[37]?.tools).toEqual([]);
    expect(requests[38]?.tools.map((item) => item.name)).toContain("python");
    expect(requests[38]?.messages).toContainEqual({
      role: "system",
      text: missingArtifactRecovery(),
    });
    expect(requests[39]?.tools).toEqual([]);
  });

  it("completes a recovered artifact by turn 40", async () => {
    const { loop, requests } = loopResults([
      ...progressTurns(),
      generated("First answer."),
      generated("", [tool("python", "recover", { source: "print('result')" })]),
      generated("Finished."),
    ]);

    const result = await loop.run(nearLimitInput([["result.unknown"]]));

    expect(result.artifacts).toEqual(["result.unknown"]);
    expect(requests).toHaveLength(40);
  });

  it("fails a repeated missing artifact response during recovery", async () => {
    const { loop, requests } = loopResults([
      ...progressTurns(),
      generated("First answer."),
      generated("Second answer."),
    ]);

    await expect(loop.run(nearLimitInput([]))).rejects.toThrow("agent_required_artifacts_missing");

    expect(requests).toHaveLength(39);
    expect(requests[38]?.tools.map((item) => item.name)).toContain("python");
  });

  it("does not start turn 41 after a recovery tool misses the artifact", async () => {
    const { loop, requests } = loopResults([
      ...progressTurns(),
      generated("First answer."),
      generated("", [tool("python", "recover", { source: "print('missing')" })]),
      generated("Final answer."),
    ]);

    await expect(loop.run(nearLimitInput([[]]))).rejects.toThrow(
      "agent_required_artifacts_missing",
    );

    expect(requests).toHaveLength(40);
    expect(requests[39]?.tools).toEqual([]);
  });

  it("keeps the final tool cutoff for a task without a required artifact", async () => {
    const { loop, requests } = loopResults([
      ...progressTurns(),
      generated("", [tool("python", "last-work", { source: "print('last')" })]),
      generated("", [tool("python", "more-work", { source: "print('more')" })]),
      generated("Finished."),
    ]);

    const result = await loop.run(nearLimitInput([[], []], "Explain the result."));

    expect(result.response).toBe("Finished.");
    expect(requests).toHaveLength(40);
    expect(requests[37]?.tools.map((item) => item.name)).toContain("python");
    expect(requests[38]?.tools.map((item) => item.name)).toContain("python");
    expect(requests[39]?.tools).toEqual([]);
  });
});
