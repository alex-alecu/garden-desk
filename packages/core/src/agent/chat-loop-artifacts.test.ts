import type { AgentExecutionResult } from "@vault/shared";
import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { generated, input, model, tool } from "./chat-loop-test-support.js";

function artifact(name: string) {
  return {
    name,
    mediaType: "text/plain",
    bytesBase64: Buffer.from(name).toString("base64"),
  };
}

function successfulResult(names: string[]): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/artifacts.py",
    source: "print('done')",
    command: null,
    exitCode: 0,
    stdout: "done\n",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: names.map(artifact),
  };
}

it("keeps a recovered artifact within the 16-card run limit", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [
          tool("python", "initial", { source: "print('initial')" }),
          tool("python", "recovery", { source: "print('recovery')" }),
        ]),
        generated("Done."),
      ],
      requests,
    ),
  );
  const names = Array.from({ length: 17 }, (_, index) => `report-${index + 1}.txt`);
  let execution = 0;

  const result = await loop.run(
    input(
      {
        async execute() {
          execution += 1;
          if (execution === 1) {
            const first = successfulResult(names.slice(0, 16));
            first.invalidatedArtifactPaths = [names[16] as string];
            first.recoverableArtifactPaths = [names[16] as string];
            return first;
          }
          return successfulResult([names[16] as string]);
        },
      },
      ["python"],
    ),
  );

  expect(result.artifacts).toHaveLength(16);
  expect(result.artifacts).not.toContain("report-1.txt");
  expect(result.artifacts).toContain("report-17.txt");
});

it("does not lose artifact eligibility during an internal inspection", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [tool("python", "initial", { source: "print('initial')" })]),
        generated("", [tool("read", "inspect", { path: "/source/input.txt" })]),
        generated("Done."),
      ],
      requests,
    ),
  );
  const names = Array.from({ length: 17 }, (_, index) => `report-${index + 1}.txt`);
  const first = successfulResult(names.slice(0, 16));
  first.invalidatedArtifactPaths = [names[16] as string];
  first.recoverableArtifactPaths = [names[16] as string];

  const result = await loop.run(
    input(
      {
        async execute() {
          return first;
        },
        async inspect() {
          return successfulResult([names[16] as string]);
        },
      },
      ["python", "read"],
    ),
  );

  expect(result.artifacts).toHaveLength(16);
  expect(result.artifacts).not.toContain("report-1.txt");
  expect(result.artifacts).toContain("report-17.txt");
});

it("retains an artifact produced by a completed sub-agent task", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [
          tool("task", "edit", {
            description: "Edit a document",
            prompt: "Create report.docx",
            subagent_type: "general",
          }),
        ]),
        generated("Done."),
      ],
      requests,
    ),
  );
  const child = successfulResult(["report.docx"]);

  const result = await loop.run(
    input(
      {
        async execute() {
          return child;
        },
      },
      ["task"],
      { spawnTask: async () => ({ response: "Created report.docx", executions: [child] }) },
    ),
  );

  expect(result.artifacts).toEqual(["report.docx"]);
});
