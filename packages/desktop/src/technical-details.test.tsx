import { AgentArtifactSummarySchema, AgentExecutionSnapshotSchema } from "@vault/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi } from "./api.js";
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
    text: "Python finished with exit code 0.",
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

function renderTechnicalDetails(): string {
  return renderToStaticMarkup(
    <TechnicalDetails
      api={{} as DesktopApi}
      artifacts={[artifact]}
      catalogPath="/Users/alex/Library/Application Support/dev.vaultdesk.desktop/state/.vault/catalog.sqlite"
      executions={[execution]}
      model={{
        modelId: "gemma-4-12b-it-qat-q4_0",
        name: "Gemma 4 12B QAT",
        state: "ready",
        thinkingSupported: true,
        memoryBudgetBytes: 16 * 1024 ** 3,
        cpuRamBytes: 1024 ** 3,
        gpuVramBytes: 11.5 * 1024 ** 3,
        contextSizeTokens: 262_144,
      }}
      onClose={() => undefined}
      onSelectStep={() => undefined}
      open
      selectedStepId={steps[1]?.id}
      sessionId="da911f87-ff26-46d8-9a58-bad222a584ab"
      steps={steps}
      thinking={null}
      timeline={timeline}
    />,
  );
}

it("shows low-level evidence without generic progress", () => {
  const markup = renderTechnicalDetails();

  expect(markup).toContain("Technical details");
  expect(markup).toContain("Local session ID: da911f87-ff26-46d8-9a58-bad222a584ab");
  expect(markup).toContain("Catalog path:");
  expect(markup).toContain("Create debug snapshot");
  expect(markup).toContain("AI agent debugging snapshot");
  expect(markup).toContain("Codex or Claude Code");
  expect(markup).toContain("SQLite-backed records");
  expect(markup).toContain("bounded microVM logs");
  expect(markup).toContain("approved channel");
  expect(markup).toContain('aria-label="Close technical details"');
  expect(markup).toContain("4 CPUs, 4 GiB memory, 128 MiB persistent workspace");
  expect(markup).toContain("Certified guest capabilities");
  expect(markup).toMatch(
    /Certified guest capabilities.*Memory allocation.*12.5 GiB.*VRAM \/ unified memory budget.*16.0 GiB.*Context window.*256K tokens/s,
  );
  expect(markup).toContain("Python: 3.14.5");
  expect(markup).toContain("/usr/bin/patch");
  expect(markup).toContain("print(&#x27;ok&#x27;)");
  expect(markup).toContain("Termination: completed");
  expect(markup).toContain("text/csv");
  expect(markup).toContain("42 bytes");
  expect(markup).not.toContain("Response completed");
  expect(markup).toContain("Step 1 · Planning the task.");
  expect(markup).toContain("Step 2 · Inspecting data.");
  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain("Code the model wrote");
  expect(markup).toContain("Recorded prompts are not loaded");
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
        path: "/tmp/vault-session-debug-ready",
      }}
    />,
  );
  expect(ready).toContain('aria-label="Debug snapshot path"');
  expect(ready).toContain("/tmp/vault-session-debug-ready");
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
