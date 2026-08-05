import { AgentDecisionSchema, type AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { artifactCandidateNames, declaredArtifactOutputs } from "./artifact-declarations.js";
import { generationInput } from "./prompt.js";

function execution(
  artifacts: Array<{ name: string; content: string }>,
  invalidatedArtifactPaths: string[] = [],
): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/0001.py",
    source: "pass",
    command: null,
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: artifacts.map(({ name, content }) => ({
      name,
      mediaType: "application/octet-stream",
      bytesBase64: Buffer.from(content).toString("base64"),
    })),
    invalidatedArtifactPaths,
  };
}

describe("declared deliverable selection", () => {
  it("uses the latest bytes and omits undeclared, missing, and removed paths", () => {
    const executions = [
      execution([
        { name: "report.docx", content: "old" },
        { name: "checkpoint.json", content: "internal" },
        { name: "state/checkpoints.json", content: "internal" },
      ]),
      execution([
        { name: "report.docx", content: "new" },
        { name: "extra.pdf", content: "extra" },
      ]),
    ];

    expect(artifactCandidateNames(executions)).toEqual(["report.docx", "extra.pdf"]);
    expect(
      declaredArtifactOutputs(
        ["report.docx", "checkpoint.json", "state/checkpoints.json", "missing.xlsx"],
        executions,
      ),
    ).toEqual([{ name: "report.docx", bytesBase64: Buffer.from("new").toString("base64") }]);
  });

  it("requires unique declarations constrained to observed candidate names", () => {
    const completed = execution([{ name: "requested.pdf", content: "pdf" }]);
    const schema = generationInput(
      { task: "Create the requested report.", modelId: "test" },
      {
        executions: [completed],
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
        rejectedDuplicates: 0,
      },
    ).jsonSchema as { oneOf: Array<{ properties: { artifacts?: { items: { enum: string[] } } } }> };
    expect(schema.oneOf[0]?.properties.artifacts?.items.enum).toEqual(["requested.pdf"]);
    expect(
      AgentDecisionSchema.safeParse({
        action: "respond",
        response: "Ready.",
        artifacts: ["requested.pdf", "requested.pdf"],
      }).success,
    ).toBe(false);
  });
});

describe("deliverable-free response schema", () => {
  it("requires an empty declaration list without emitting an invalid empty enum", () => {
    const schema = generationInput(
      { task: "Answer directly.", modelId: "test" },
      {
        executions: [],
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
        rejectedDuplicates: 0,
      },
    ).jsonSchema as { oneOf: Array<{ properties: { artifacts: Record<string, unknown> } }> };
    expect(schema.oneOf[0]?.properties.artifacts).toEqual({ type: "array", maxItems: 0 });
  });
});
