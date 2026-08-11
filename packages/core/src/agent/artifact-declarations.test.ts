import { AgentDecisionSchema, type AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  artifactCandidateNames,
  declaredArtifactOutputs,
  requestedArtifactNames,
} from "./artifact-declarations.js";
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
});

describe("deliverable freshness", () => {
  it("keeps captured deliverables across unrelated output and later deliverables", () => {
    const docx = execution([{ name: "story.docx", content: "docx" }]);
    const noOp: AgentExecutionResult = {
      ...execution([]),
      language: "shell",
      path: null,
      source: null,
      command: "true",
      stdout: "calculation complete\n",
      stderr: "diagnostic output\n",
    };
    const pdf = execution([{ name: "story.pdf", content: "pdf" }]);

    expect(artifactCandidateNames([docx, noOp, pdf])).toEqual(["story.docx", "story.pdf"]);
  });

  it("uses workspace invalidation and recapture as the freshness authority", () => {
    const created = execution([
      { name: "changed.pdf", content: "old" },
      { name: "removed.docx", content: "removed" },
    ]);
    const changed = execution([], ["changed.pdf", "removed.docx"]);
    const recaptured = execution([{ name: "changed.pdf", content: "new" }], ["changed.pdf"]);

    expect(artifactCandidateNames([created, changed])).toEqual([]);
    expect(declaredArtifactOutputs(["changed.pdf"], [created, recaptured])).toEqual([
      { name: "changed.pdf", bytesBase64: Buffer.from("new").toString("base64") },
    ]);
  });

  it("invalidates a deliverable when later analysis changes a required fact", () => {
    const created = {
      ...execution([{ name: "report.docx", content: "stale" }]),
      stdout: "MATCHING_INVOICES=0\nINVOICE_TOTAL=0.0\n",
    };
    const corrected = {
      ...execution([]),
      stdout: "MATCHING_INVOICES=8\nINVOICE_TOTAL=20012.0\n",
    };
    const labels = ["MATCHING_INVOICES", "INVOICE_TOTAL"];

    expect(artifactCandidateNames([created, corrected], labels)).toEqual([]);
  });

  it("accepts a deliverable recaptured after corrected facts", () => {
    const created = {
      ...execution([{ name: "report.docx", content: "stale" }]),
      stdout: "MATCHING_INVOICES=0\n",
    };
    const corrected = { ...execution([]), stdout: "MATCHING_INVOICES=8\n" };
    const recaptured = execution([{ name: "report.docx", content: "fresh" }]);

    expect(artifactCandidateNames([created, corrected, recaptured], ["MATCHING_INVOICES"])).toEqual(
      ["report.docx"],
    );
  });
});

describe("deliverable response contract", () => {
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

  it("keeps the task prompt and response schema aligned with all current deliverables", () => {
    const executions = [
      execution([{ name: "story.docx", content: "docx" }]),
      { ...execution([]), stdout: "unrelated output\n" },
      execution([{ name: "story.pdf", content: "pdf" }]),
    ];
    const generated = generationInput(
      { task: "Write a short story for children in a Word and PDF document.", modelId: "test" },
      {
        executions,
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
        rejectedDuplicates: 0,
      },
    );
    const schema = generated.jsonSchema as {
      oneOf: Array<{ properties: { artifacts?: { items: { enum: string[] } } } }>;
    };

    expect(generated.prompt).toContain('Produced artifact names: ["story.docx","story.pdf"]');
    expect(schema.oneOf[0]?.properties.artifacts?.items.enum).toEqual(["story.docx", "story.pdf"]);
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

describe("explicitly named deliverables", () => {
  it("treats only the into-target as output for a PDF merge", () => {
    const task =
      "Combine cover.pdf followed by appendix.pdf into board-pack.pdf and rotate its final page.";
    expect(requestedArtifactNames(task)).toEqual(["board-pack.pdf"]);
  });

  it("requires source execution until the requested file is observed", () => {
    const task = "Create a polished PDF named management-report.pdf in the workspace.";
    expect(requestedArtifactNames(task)).toEqual(["management-report.pdf"]);
    const schema = generationInput(
      { task, modelId: "test" },
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
    ).jsonSchema;

    expect(schema).not.toHaveProperty("oneOf");
    expect(schema).toMatchObject({ properties: { action: { const: "execute" } } });
  });

  it("prioritizes a missing named deliverable when one execution remains", () => {
    const task = "Create management-report.pdf in the workspace.";
    const progress = {
      executions: Array.from({ length: 5 }, () => execution([])),
      inference: {
        promptTokens: 0,
        outputTokens: 0,
        promptDurationMs: 0,
        generationDurationMs: 0,
        totalDurationMs: 0,
      },
      rejectedDuplicates: 0,
    };
    const prompt = generationInput({ task, modelId: "test" }, progress).prompt;

    expect(prompt).toContain("Only one execution remains");
    expect(prompt).toContain('["management-report.pdf"]');
    expect(prompt).toContain("Derive any missing fact");
    expect(prompt).toContain("Do not repeat completed analysis");
  });
});

describe("deliverable fact labels", () => {
  it("adds exact deliverable labels only after initial context allocation", () => {
    const task = "Create report.pdf and visibly label MATCHING_INVOICES and INVOICE_TOTAL.";
    const empty = {
      executions: [],
      inference: {
        promptTokens: 0,
        outputTokens: 0,
        promptDurationMs: 0,
        generationDurationMs: 0,
        totalDurationMs: 0,
      },
      rejectedDuplicates: 0,
    };
    expect(generationInput({ task, modelId: "test" }, empty).prompt).not.toContain(
      "Every requested deliverable must preserve",
    );
    const afterExecution = { ...empty, executions: [execution([])] };
    expect(generationInput({ task, modelId: "test" }, afterExecution).prompt).toContain(
      'Every requested deliverable must preserve these exact LABEL=value facts: ["MATCHING_INVOICES","INVOICE_TOTAL"]',
    );
  });

  it("decomposes several named outputs into incremental actions", () => {
    const request = generationInput(
      { task: "Create report.pdf, report.docx, and report.xlsx.", modelId: "test" },
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
    );
    expect(request.prompt).toContain("gather shared facts once");
    expect(request.prompt).toContain("create at most one missing file per later execution");
  });
});
