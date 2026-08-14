import { AgentArtifactSummarySchema, AgentExecutionSnapshotSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { sessionTranscript, transcriptHasContent } from "./session-transcript.js";
import type { TimelineItem } from "./state.js";

const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const sessionId = "3d6f0c2a-2f4a-4d0e-9f7e-2a1b3c4d5e6f";

const timeline: TimelineItem[] = [
  { createdAt: "2026-08-12T12:00:00.000Z", id: "user", kind: "user", text: "Build a report" },
  {
    createdAt: "2026-08-12T12:00:01.000Z",
    eventType: "run.started",
    id: "limits",
    kind: "activity",
    runId,
    text: "Offline limits: 4 CPUs.",
  },
  {
    createdAt: "2026-08-12T12:00:02.000Z",
    eventType: "inference.started",
    id: "planning",
    kind: "activity",
    runId,
    text: "Planning the task.",
  },
  {
    createdAt: "2026-08-12T12:00:03.000Z",
    detail: "Code:\nprint('x')",
    eventType: "execution.started",
    id: "exec-start",
    kind: "activity",
    runId,
    text: "Running code.",
    toolName: "python",
    toolCallId: "call-1",
  },
  {
    createdAt: "2026-08-12T12:00:04.000Z",
    eventType: "execution.completed",
    id: "exec-done",
    kind: "activity",
    runId,
    text: "Finished this step.",
    toolName: "python",
    toolCallId: "call-1",
  },
  {
    createdAt: "2026-08-12T12:00:06.000Z",
    id: "assistant",
    kind: "assistant",
    text: "The report is ready.",
    runId,
  },
];

const execution = AgentExecutionSnapshotSchema.parse({
  id: "8546e320-b1ef-48df-8ea1-51524d95ca1a",
  runId,
  sequence: 0,
  language: "python",
  path: "steps/0001.py",
  source: "print('financials')",
  command: null,
  state: "completed",
  exitCode: 0,
  durationMs: 12,
  termination: "completed",
  stdout: "financials ready\n",
  stderr: "",
  vmDiagnostics: [],
  stdoutBytes: 16,
  stderrBytes: 0,
  vmDiagnosticsBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  vmDiagnosticsTruncated: false,
  createdAt: "2026-08-12T12:00:03.000Z",
  updatedAt: "2026-08-12T12:00:04.000Z",
  completedAt: "2026-08-12T12:00:04.000Z",
});

const artifact = AgentArtifactSummarySchema.parse({
  id: "6ad824dc-bd7a-431a-9b2a-e79cdb8a98fe",
  runId,
  name: "financial_summary_2025.pdf",
  mediaType: "application/pdf",
  byteLength: 2_560,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: "2026-08-12T12:00:05.000Z",
});

function toolIdentityTranscript(): string {
  const toolTimeline: TimelineItem[] = [
    { createdAt: "t0", id: "user", kind: "user", text: "Review the file" },
    {
      createdAt: "t1",
      detail: "Tool: skill\n\nCall ID: call-1",
      eventType: "tool.started",
      id: "start",
      kind: "activity",
      runId,
      text: "Loading documents skill",
      toolName: "skill",
      toolCallId: "call-1",
    },
    {
      createdAt: "t2",
      detail: "Tool: skill\n\nCall ID: call-1\n\nOutput:\nSkill body.",
      eventType: "tool.completed",
      id: "done",
      kind: "activity",
      runId,
      text: "Loaded documents skill.",
      toolName: "skill",
      toolCallId: "call-1",
    },
  ];
  return sessionTranscript({
    sessionId,
    title: "Review the file",
    timeline: toolTimeline,
    executions: [],
    artifacts: [],
  });
}

describe("sessionTranscript", () => {
  const markdown = sessionTranscript({
    sessionId,
    title: "Build a report",
    timeline,
    executions: [execution],
    artifacts: [artifact],
  });

  it("orders the heading, user, step, and assistant sections in timeline order", () => {
    const order = ["# Build a report", "## You", "### Step", "## Assistant"];
    const positions = order.map((needle) => markdown.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("includes the session id, model code, output, and generated files", () => {
    expect(markdown).toContain(`**Session ID:** ${sessionId}`);
    expect(markdown).toContain("```python\nprint('financials')\n```");
    expect(markdown).toContain("financials ready");
    expect(markdown).toContain("Exit code: 0 · Duration: 12 ms · Termination: completed");
    expect(markdown).toContain("- financial_summary_2025.pdf · 2.5 KB");
  });

  it("drops run framing but keeps the executed step and the assistant reply", () => {
    expect(markdown).not.toContain("Offline limits");
    expect(markdown).toContain("### Step 2 · Running code. — done");
    expect(markdown).toContain("The report is ready.");
  });

  it("reports whether a timeline has any conversational content", () => {
    expect(transcriptHasContent(timeline)).toBe(true);
    expect(transcriptHasContent([])).toBe(false);
  });
});

describe("sessionTranscript tool identity", () => {
  it("includes a tool identity once when start and completion details repeat it", () => {
    const transcript = toolIdentityTranscript();

    expect(transcript.match(/Tool: skill/gu)).toHaveLength(1);
    expect(transcript.match(/Call ID: call-1/gu)).toHaveLength(1);
    expect(transcript).toContain("Output:\nSkill body.");
  });
});
