import { AgentEventSchema, AgentExecutionSnapshotSchema } from "@gardendesk/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunProgress } from "./components/run-progress.js";
import { copyStepText, StepDetails } from "./components/step-details.js";
import { agentSteps } from "./steps.js";
import { eventItems } from "./timeline.js";

const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const createdAt = "2026-08-11T12:00:00.000Z";

interface EventInput {
  id: string;
  sequence: number;
  type: "tool.started" | "tool.completed" | "subagent.started" | "subagent.completed";
  summary: string;
  toolName: string;
  toolCallId: string;
}

function event(input: EventInput) {
  return AgentEventSchema.parse({
    ...input,
    runId,
    createdAt,
  });
}

const toolStarted = event({
  id: "11111111-1111-4111-8111-111111111111",
  sequence: 0,
  type: "tool.started",
  summary: "Reading files.",
  toolName: "read",
  toolCallId: "call-1",
});
const toolCompleted = event({
  id: "22222222-2222-4222-8222-222222222222",
  sequence: 1,
  type: "tool.completed",
  summary: "Read 3 files.",
  toolName: "read",
  toolCallId: "call-1",
});
const subagentStarted = event({
  id: "33333333-3333-4333-8333-333333333333",
  sequence: 2,
  type: "subagent.started",
  summary: "Reviewing the workbook.",
  toolName: "reviewer",
  toolCallId: "subagent-1",
});
const subagentCompleted = event({
  id: "44444444-4444-4444-8444-444444444444",
  sequence: 3,
  type: "subagent.completed",
  summary: "No inconsistencies found.",
  toolName: "reviewer",
  toolCallId: "subagent-1",
});
const directExecution = AgentExecutionSnapshotSchema.parse({
  id: "30ea136e-6048-4865-a9f7-61acdb45b2a4",
  runId,
  sequence: 0,
  language: "python",
  path: "/source/find-transactions.py",
  source: null,
  command: null,
  state: "completed",
  exitCode: 0,
  durationMs: 2,
  termination: "completed",
  stdout: "",
  stderr: "",
  vmDiagnostics: [],
  stdoutBytes: 0,
  stderrBytes: 0,
  vmDiagnosticsBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  vmDiagnosticsTruncated: false,
  createdAt,
  updatedAt: createdAt,
  completedAt: createdAt,
});

describe("tool activity timeline", () => {
  it("renders tool calls as activity steps with identity", () => {
    const items = eventItems([toolStarted, toolCompleted]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ eventType: "tool.started", text: "Reading files." });
    expect(items[1]?.detail).toContain("Tool: read");
    expect(agentSteps(items, []).map((step) => step.kind)).toEqual(["tool", "tool"]);
  });

  it("collapses a sub-agent pair into one description and result activity", () => {
    const items = eventItems([subagentStarted, subagentCompleted]);
    const step = agentSteps(items, [])[0];

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      eventType: "subagent.completed",
      text: "Reviewing the workbook.",
    });
    expect(items[0]?.detail).toContain("Result:\nNo inconsistencies found.");
    expect(step?.kind).toBe("subagent");
    if (step === undefined) throw new Error("Expected a sub-agent step.");
    const markup = renderToStaticMarkup(<StepDetails step={step} thinking={null} />);
    expect(markup).toContain("No inconsistencies found.");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("Wrap text");
    expect(markup).toContain('aria-label="Copy Details"');
  });

  it("counts completed tool calls in live progress", () => {
    const markup = renderToStaticMarkup(
      <RunProgress runId={runId} timeline={eventItems([toolStarted, toolCompleted])} />,
    );

    expect(markup).toContain("1 tool call completed");
  });

  it("copies exact step evidence", async () => {
    let copied = "";

    await copyStepText("First line\nSecond line", {
      writeText(text) {
        copied = text;
        return Promise.resolve();
      },
    });

    expect(copied).toBe("First line\nSecond line");
  });
});

it("shows the live path for direct source execution", () => {
  const markup = renderToStaticMarkup(
    <StepDetails
      step={{
        id: "direct-source",
        runId,
        ordinal: 1,
        kind: "execution",
        title: "Inspecting the selected folder.",
        execution: directExecution,
      }}
      thinking={null}
    />,
  );

  expect(markup).toContain("/source/find-transactions.py");
});
