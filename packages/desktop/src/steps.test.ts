import { AgentExecutionSnapshotSchema, AgentTraceSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { TimelineItem } from "./state.js";
import { activeThinkingStepId, agentSteps, selectedStep } from "./steps.js";

const runId = "b5627b1c-cea8-4ec1-b93f-068a36eedb29";
const timestamp = "2026-07-29T06:58:44.559Z";

function execution(sequence: number, path: string) {
  return AgentExecutionSnapshotSchema.parse({
    id: `8546e320-b1ef-48df-8ea1-51524d95ca${String(sequence).padStart(2, "0")}`,
    runId,
    sequence,
    language: "python",
    path,
    source: `# ${path}`,
    command: null,
    state: "completed",
    exitCode: 0,
    durationMs: 2_500,
    termination: "completed",
    stdout: "extracted\n",
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: 10,
    stderrBytes: 0,
    vmDiagnosticsBytes: 2,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

const timeline: TimelineItem[] = [
  { createdAt: timestamp, id: "user", kind: "user", text: "Give me a summary" },
  {
    createdAt: timestamp,
    eventType: "run.started",
    id: "limits",
    kind: "activity",
    runId,
    text: "Offline limits",
  },
  {
    createdAt: timestamp,
    eventType: "inference.started",
    id: "plan-1",
    kind: "activity",
    runId,
    text: "Loading the local model and planning the task.",
  },
  {
    createdAt: timestamp,
    eventType: "execution.started",
    id: "exec-1-start",
    kind: "activity",
    runId,
    text: "Read the attached PDF.",
    detail: "Source:\n# steps/1.py",
  },
  {
    createdAt: timestamp,
    eventType: "execution.completed",
    id: "exec-1-done",
    kind: "activity",
    runId,
    text: "Finished this step.",
  },
  {
    createdAt: timestamp,
    eventType: "inference.started",
    id: "plan-2",
    kind: "activity",
    runId,
    text: "Planning step 2.",
  },
  {
    createdAt: timestamp,
    eventType: "execution.started",
    id: "exec-2-start",
    kind: "activity",
    runId,
    text: "Summarize the text.",
    detail: "Source:\n# steps/2.py",
  },
  {
    createdAt: timestamp,
    eventType: "execution.completed",
    id: "exec-2-done",
    kind: "activity",
    runId,
    text: "Finished this step.",
  },
  {
    createdAt: timestamp,
    eventType: "assistant.completed",
    id: "done",
    kind: "activity",
    runId,
    text: "Response completed.",
  },
  {
    createdAt: timestamp,
    eventType: "question.answered",
    id: "question-evidence",
    kind: "activity",
    runId,
    text: "Question answered.",
  },
];

function trace(executionSequence: number | null) {
  return AgentTraceSchema.parse({
    runId,
    captureVersion: 1,
    status: "recorded",
    turns: [
      {
        id: "20b6b08f-4627-4b4d-abf9-d36300fa819b",
        runId,
        sequence: 0,
        phase: "decision",
        requestId: "04d39cfe-9855-4045-8509-9a1d57e11654",
        jobId: "61ddca70-15fc-4082-9287-396cce15ee6b",
        modelId: "gemma-4-12b-it-qat-q4_0",
        contextSize: "auto",
        maxTokens: 32_768,
        allocatedContextTokens: 131_072,
        promptHash: `sha256:${"a".repeat(64)}`,
        schemaHash: `sha256:${"b".repeat(64)}`,
        responseHash: `sha256:${"c".repeat(64)}`,
        prompt: "You are an offline development agent.",
        jsonSchema: { type: "object" },
        structuredResponse: { action: "execute" },
        outcome: "accepted_execution",
        executionSequence,
        createdAt: timestamp,
        responseCapturedAt: timestamp,
        completedAt: timestamp,
      },
    ],
  });
}

describe("agent steps", () => {
  it("keeps only activity steps and hides run limits and completion", () => {
    const steps = agentSteps(timeline, []);

    expect(steps.map((step) => step.id)).toEqual([
      "plan-1",
      "exec-1-start",
      "exec-1-done",
      "plan-2",
      "exec-2-start",
      "exec-2-done",
    ]);
    expect(steps.map((step) => step.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("active thinking step", () => {
  it("identifies only the latest planning event in the active run", () => {
    expect(activeThinkingStepId(timeline, runId, "Thinking")).toBe("plan-2");
    expect(activeThinkingStepId(timeline, runId, null)).toBeUndefined();
    expect(activeThinkingStepId(timeline, "another-run", "Thinking")).toBeUndefined();
  });
});

describe("agent step evidence", () => {
  it("joins each execution pair to its ordered execution snapshot", () => {
    const steps = agentSteps(timeline, [execution(0, "steps/1.py"), execution(1, "steps/2.py")]);
    const paths = steps.map((step) => step.execution?.path);

    expect(paths).toEqual([
      undefined,
      "steps/1.py",
      "steps/1.py",
      undefined,
      "steps/2.py",
      "steps/2.py",
    ]);
  });

  it("classifies planning, execution, and carries the precomputed detail", () => {
    const steps = agentSteps(timeline, []);

    expect(steps[0]).toMatchObject({
      kind: "planning",
      title: "Loading the local model and planning the task.",
    });
    expect(steps[1]).toMatchObject({ kind: "execution", detail: "Source:\n# steps/1.py" });
  });

  it("attaches the recorded prompt and decision to the matching steps", () => {
    const steps = agentSteps(timeline, [execution(0, "steps/1.py")], [trace(0)]);

    expect(steps[0]?.turn?.prompt).toBe("You are an offline development agent.");
    expect(steps[1]?.turn?.structuredResponse).toEqual({ action: "execute" });
    expect(steps[3]?.turn).toBeUndefined();
  });
});

describe("agent step recovery evidence", () => {
  it("does not reuse a hidden structured retry as the next planning turn", () => {
    const recorded = trace(0);
    if (recorded.status !== "recorded") throw new Error("Expected a recorded trace.");
    const accepted = recorded.turns[0];
    if (accepted === undefined) throw new Error("Expected one trace turn.");
    const traces = [
      {
        ...recorded,
        turns: [
          {
            ...accepted,
            prompt: "Failed first attempt",
            outcome: "inference_failed" as const,
            executionSequence: null,
          },
          { ...accepted, sequence: 1, prompt: "Retry for step 1" },
          { ...accepted, sequence: 2, prompt: "Plan for step 2", executionSequence: 1 },
        ],
      },
    ];

    const steps = agentSteps(
      timeline,
      [execution(0, "steps/1.py"), execution(1, "steps/2.py")],
      traces,
    );

    expect(steps[0]?.turn?.prompt).toBe("Failed first attempt");
    expect(steps[1]?.turn?.prompt).toBe("Retry for step 1");
    expect(steps[3]?.turn?.prompt).toBe("Plan for step 2");
  });
});

describe("agent step trace availability", () => {
  it("reports no turn when the run predates trace capture", () => {
    const notRecorded = AgentTraceSchema.parse({
      runId,
      captureVersion: 0,
      status: "not_recorded",
      turns: [],
    });

    expect(agentSteps(timeline, [], [notRecorded]).every((step) => step.turn === undefined)).toBe(
      true,
    );
  });

  it("finds the selected step by identifier", () => {
    const steps = agentSteps(timeline, []);

    expect(selectedStep(steps, "plan-2")?.title).toBe("Planning step 2.");
    expect(selectedStep(steps, "missing")).toBeUndefined();
  });
});
