import { AgentArtifactSummarySchema, AgentExecutionSnapshotSchema } from "@gardendesk/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi } from "./api.js";
import { SourceCode } from "./components/source-code.js";
import {
  DebugSnapshotPanel,
  shouldFollowLog,
  TechnicalDetails,
} from "./components/technical-details.js";
import { LogsPanel } from "./components/technical-logs.js";
import { initialDebugSnapshotState } from "./debug-snapshot.js";
import type { TimelineItem } from "./state.js";
import { agentSteps } from "./steps.js";

const timestamp = "2026-07-20T12:00:00.000Z";
const artifact = AgentArtifactSummarySchema.parse({
  id: "6ad824dc-bd7a-431a-9b2a-e79cdb8a98fe",
  runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
  name: "report.csv",
  mediaType: "text/csv",
  byteLength: 42,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: timestamp,
});
const execution = AgentExecutionSnapshotSchema.parse({
  id: "8546e320-b1ef-48df-8ea1-51524d95ca1a",
  runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
  sequence: 0,
  language: "python",
  path: "steps/0001.py",
  source: "print('ok')",
  command: null,
  state: "completed",
  exitCode: 0,
  durationMs: 2,
  termination: "completed",
  stdout: "private output\n",
  stderr: "",
  vmDiagnostics: [],
  stdoutBytes: 15,
  stderrBytes: 0,
  vmDiagnosticsBytes: 2,
  stdoutTruncated: false,
  stderrTruncated: false,
  vmDiagnosticsTruncated: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: timestamp,
});
const activeExecution = AgentExecutionSnapshotSchema.parse({
  ...execution,
  id: "54c5ad78-d10f-4447-aa3f-f68b315ed890",
  sequence: 1,
  state: "running",
  exitCode: null,
  durationMs: null,
  termination: null,
  stdout: "live output\n",
  stdoutBytes: 12,
  vmDiagnostics: [
    {
      sequence: 0,
      code: "process_start",
      platform: "guest",
      platformCode: null,
      createdAt: timestamp,
    },
  ],
  completedAt: null,
});
const timeline = [
  {
    createdAt: timestamp,
    eventType: "run.started",
    id: "limits",
    kind: "activity",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    text: "Offline limits: 4 CPUs, 4 GiB memory, 128 MiB persistent workspace.",
  },
  {
    createdAt: timestamp,
    eventType: "inference.started",
    id: "planning",
    kind: "activity",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    text: "Planning the task.",
  },
  {
    createdAt: timestamp,
    detail: "Code:\nprint('ok')",
    eventType: "execution.started",
    id: "code",
    kind: "activity",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    text: "Inspecting data.",
  },
  {
    createdAt: timestamp,
    detail: "Output:\nok\n\nTermination: completed",
    eventType: "execution.completed",
    id: "output",
    kind: "activity",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    text: "Finished this step.",
  },
  {
    createdAt: timestamp,
    eventType: "assistant.completed",
    id: "completed",
    kind: "activity",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    text: "Response completed.",
  },
] satisfies TimelineItem[];

const steps = agentSteps(timeline, [execution, activeExecution]);

function renderTechnicalDetails(selectedStepId?: string, nativeActionMessage?: string): string {
  return renderToStaticMarkup(
    <TechnicalDetails
      api={{} as DesktopApi}
      artifacts={[artifact]}
      catalogPath="/Users/alex/Library/Application Support/ai.gardendesk.desktop/state/.garden-desk/catalog.sqlite"
      executions={[execution]}
      model={{
        modelId: "gemma-4-12b-it-qat-q4_0",
        name: "Gemma 4 12B QAT",
        state: "ready",
        thinkingSupported: true,
        memoryBudgetBytes: 16 * 1024 ** 3,
        cpuRamBytes: 1024 ** 3,
        gpuMemoryBytes: 11.5 * 1024 ** 3,
        gpuMemoryKind: "unified",
        contextSizeTokens: 131_072,
        contextLimitTokens: 131_072,
        contextLimitReason: "dedicated_memory_above_24_gib",
      }}
      nativeActionMessage={nativeActionMessage}
      onClose={() => undefined}
      onSelectStep={() => undefined}
      open
      selectedStepId={selectedStepId}
      sessionId="da911f87-ff26-46d8-9a58-bad222a584ab"
      steps={steps}
      thinkingByStep={{}}
      thinkingStepId={undefined}
      timeline={timeline}
    />,
  );
}

it("keeps the overview separate from step evidence", () => {
  const markup = renderTechnicalDetails();

  expect(markup).toContain("Technical details");
  expect(markup).toContain('<hr aria-label="Resize technical details"');
  expect(markup).toContain('class="technical-details-resize-handle"');
  expect(markup).toContain("Local session ID: da911f87-ff26-46d8-9a58-bad222a584ab");
  expect(markup).toContain("Catalog path:");
  expect(markup).toContain("Create debug snapshot");
  expect(markup).toContain("AI agent debugging snapshot");
  expect(markup).toContain("Codex or Claude Code");
  expect(markup).toContain("SQLite-backed records");
  expect(markup).toContain("bounded microVM logs");
  expect(markup).toContain("approved channel");
  expect(markup).toContain('aria-label="Close technical details"');
  expect(markup).toContain('aria-label="Technical details sections"');
  expect(markup).toMatch(/aria-selected="true"[^>]*>Overview/);
  expect(markup).toContain("4 CPUs, 4 GiB memory, 128 MiB persistent workspace");
  expect(markup).toContain("Certified guest capabilities");
  expect(markup).toMatch(/Certified guest capabilities.*Unified GPU memory.*12.5 GiB of 16.0 GiB/s);
  expect(markup).not.toContain("Why this context");
  expect(markup).not.toContain("Total model and context allocation");
  expect(markup).toContain("Python: 3.14.5");
  expect(markup).toContain("/usr/bin/patch");
  expect(markup).not.toContain("text/csv");
  expect(markup).not.toContain("42 bytes");
  expect(markup).not.toContain("generated-file metadata");
  expect(markup).not.toContain("Response completed");
  expect(markup).not.toContain("Step 1 · Planning the task.");
  expect(markup).not.toContain("Code the model wrote");
});

it("offers a session transcript copy action in the overview", () => {
  const markup = renderTechnicalDetails();

  expect(markup).toContain("Copy session transcript");
  expect(markup).toMatch(/class="transcript-copy"/);
  expect(markup).not.toMatch(/class="transcript-copy">[\s\S]*?disabled/);
});

it("disables the transcript copy when native actions are unavailable", () => {
  const markup = renderTechnicalDetails(undefined, "Unavailable in the public demo");

  expect(markup).toContain("Copy session transcript");
  expect(markup).toMatch(/class="transcript-copy">[\s\S]*?disabled/);
  expect(markup).toContain('title="Unavailable in the public demo"');
});

it("opens a selected step in its own tab with highlighted Python source", () => {
  const markup = renderTechnicalDetails(steps[1]?.id);

  expect(markup).toMatch(/aria-selected="true"[^>]*>Steps/);
  expect(markup).toContain("Step 1 · Planning the task.");
  expect(markup).toContain("Step 2 · Inspecting data.");
  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain("Code the model wrote");
  expect(markup).toContain("steps/0001.py");
  expect(markup).toContain("Python");
  expect(markup).toContain('class="syntax-builtin"');
  expect(markup).toContain('class="syntax-string"');
  expect(markup).toContain("Recorded prompts are not loaded");
  expect(markup).not.toContain("Local session ID:");
  expect(markup).not.toContain("Certified guest capabilities");
  expect(markup).not.toContain("text/csv");
});

it("highlights generated Node source with its assigned filename", () => {
  const markup = renderToStaticMarkup(
    <SourceCode
      language="node"
      path="steps/0002.mjs"
      source={'import fs from "node:fs";\nconst count = 3;\nconsole.log(count);'}
    />,
  );

  expect(markup).toContain("steps/0002.mjs");
  expect(markup).toContain("Node.js");
  expect(markup).toContain('class="syntax-keyword"');
  expect(markup).toContain('class="syntax-string"');
  expect(markup).toContain('class="syntax-number"');
  expect(markup).toContain('class="syntax-builtin"');
});

it("shows pending, success, reveal, and failure states", () => {
  const pending = renderToStaticMarkup(
    <DebugSnapshotPanel
      onCreate={() => undefined}
      onReveal={() => undefined}
      state={{ ...initialDebugSnapshotState, creating: true }}
    />,
  );
  expect(pending).toContain("Creating snapshot…");
  expect(pending).toContain("disabled");

  const ready = renderToStaticMarkup(
    <DebugSnapshotPanel
      onCreate={() => undefined}
      onReveal={() => undefined}
      state={{
        ...initialDebugSnapshotState,
        path: "/tmp/garden-desk-session-debug-ready",
      }}
    />,
  );
  expect(ready).toContain('aria-label="Debug snapshot path"');
  expect(ready).toContain("/tmp/garden-desk-session-debug-ready");
  expect(ready).toContain("Reveal snapshot");

  const failed = renderToStaticMarkup(
    <DebugSnapshotPanel
      onCreate={() => undefined}
      onReveal={() => undefined}
      state={{
        ...initialDebugSnapshotState,
        error: "The debug snapshot could not be created.",
      }}
    />,
  );
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("could not be created");
});

it("follows only while the viewer remains near the bottom", () => {
  expect(shouldFollowLog(1_000, 760, 200)).toBe(true);
  expect(shouldFollowLog(1_000, 600, 200)).toBe(false);
});

it("opens only the active execution after Logs is selected", () => {
  const markup = renderToStaticMarkup(<LogsPanel executions={[execution, activeExecution]} />);

  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-label="Output for execution 2"');
  expect(markup).toContain("live output");
  expect(markup).not.toContain("private output");
  expect(markup).toContain("readOnly");
});
