import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGardenDeskCore, type GardenDeskCore } from "@gardendesk/core";
import {
  type AgentRunSnapshot,
  DEFAULT_THINKING_LEVEL,
  INFERENCE_PROFILE,
} from "@gardendesk/shared";
import { cases as obligations } from "../stress/specialist-contract-obligations.js";
import { cases as comparison } from "../stress/specialist-document-comparison.js";
import { cases as brief } from "../stress/specialist-evidence-brief.js";
import { cases as reconciliation } from "../stress/specialist-financial-reconciliation.js";
import { cases as extraction } from "../stress/specialist-financial-record-extraction.js";
import { prepareSpecialistFiles, type SpecialistCase } from "../stress/specialist-fixtures.js";
import { cases as intake } from "../stress/specialist-folder-intake.js";
import { cases as expenses } from "../stress/specialist-invoice-expense-review.js";
import { cases as chronology } from "../stress/specialist-matter-chronology.js";
import { prepareAgentModelStore } from "./agent-model-store.js";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";

const repository = process.cwd();
const macos = process.platform === "darwin";
const label = argument("--label") ?? INFERENCE_PROFILE.modelId;
const runtimeDirectory =
  argument("--runtime") ??
  join(
    repository,
    "packages/eval/.generated/inference",
    macos ? "macos-arm64" : "windows-cuda-x64",
  );
const imageRoot = argument("--images") ?? join(repository, "packages/workers/images");
const selected = argument("--cases")?.split(",");
const cases = [
  ...intake,
  ...chronology,
  ...obligations,
  ...comparison,
  ...extraction,
  ...reconciliation,
  ...expenses,
  ...brief,
].filter(
  (item) => item.command === undefined && (selected === undefined || selected.includes(item.id)),
);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function openCore(root: string): Promise<GardenDeskCore> {
  const modelStoreDir = join(repository, "packages/eval/.generated/models");
  await prepareAgentModelStore(modelStoreDir);
  const macosHelper = join(
    repository,
    "packages/workers/native/macos-vz-helper/.generated/garden-desk-vz-helper",
  );
  return createGardenDeskCore({
    workspaceDir: join(root, "state"),
    modelStoreDir,
    profile: "auto",
    migrationDirectory: join(repository, "packages/core/src/workspace/migrations"),
    promptDirectory: join(repository, "prompts"),
    workerEntryPath: macos ? developmentInferenceWorkerEntryPath() : "",
    ...(macos
      ? {}
      : {
          inferenceHelperPath: join(
            repository,
            "packages/workers/native/windows-appcontainer-launcher/.generated/garden-desk-appcontainer-launcher.exe",
          ),
        }),
    inferenceRuntimePath: join(runtimeDirectory, macos ? "llama-server" : "llama-server.exe"),
    agentHelperPath: macos
      ? macosHelper
      : join(
          repository,
          "packages/workers/native/windows-hcs-helper/.generated/garden-desk-hcs-helper.exe",
        ),
    agentImageRoot: imageRoot,
  });
}

async function terminal(
  core: GardenDeskCore,
  runId: string,
  jobId: string,
): Promise<AgentRunSnapshot> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const snapshot = await core.getAgentRun(runId);
    if (snapshot.question !== null) {
      await core.cancelAgent(jobId);
      return snapshot;
    }
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await core.cancelAgent(jobId);
  return await core.getAgentRun(runId);
}

async function reportText(core: GardenDeskCore, snapshot: AgentRunSnapshot): Promise<string> {
  const artifact = snapshot.artifacts.find((item) => item.name === "result.md");
  if (artifact === undefined) return snapshot.run.response ?? "";
  return await readFile(
    await core.materializeArtifact(snapshot.run.sessionId, artifact.id),
    "utf8",
  );
}

function coverage(report: string, values: string[]): number {
  if (values.length === 0) return 1;
  return values.filter((value) => report.includes(value)).length / values.length;
}

async function score(
  core: GardenDeskCore,
  task: SpecialistCase,
  snapshot: AgentRunSnapshot,
  began: number,
) {
  const report = await reportText(core, snapshot);
  const chosen = snapshot.childRuns.map((child) => child.agentId ?? "");
  const facts = coverage(report, Object.values(task.expected).map(String));
  const sources = coverage(report, task.sources);
  const succeeded = snapshot.run.state === "succeeded";
  return {
    id: task.id,
    expectedSpecialist: task.agentId,
    chosenSpecialists: chosen,
    specialistCorrect: chosen[0] === task.agentId,
    succeeded,
    error: snapshot.run.error,
    factCoverage: facts,
    sourceCoverage: sources,
    quality: succeeded
      ? Math.round(
          (0.6 * facts + 0.2 * sources + 0.2 * (chosen[0] === task.agentId ? 1 : 0)) * 100,
        ) / 100
      : 0,
    durationMs: Date.now() - began,
    performance: snapshot.run.performance,
    contextUsedTokens: snapshot.contextUsedTokens,
    report,
  };
}

async function run(task: SpecialistCase) {
  const root = await mkdtemp(
    join(repository, `packages/eval/.generated/model-comparison/${label}-${task.id}-`),
  );
  const source = join(root, "source");
  await prepareSpecialistFiles(source, task.files);
  const core = await openCore(root);
  const began = Date.now();
  try {
    const folder = await core.addFolder(source);
    await prepareSpecialistFiles(source, task.addedAfterGrant ?? {});
    const session = await core.createSession(folder.id);
    const prompt = `${task.request}\nUse the source files in /source. Write a concise final report to /workspace/result.md with the facts requested and source file references with page, paragraph, or row locations. Return a short summary. Do not change the source files.`;
    const started = await core.startAgent(session.id, prompt, DEFAULT_THINKING_LEVEL);
    return await score(core, task, await terminal(core, started.id, started.jobId), began);
  } finally {
    await core.close();
  }
}

const rows = [];
for (const task of cases) {
  console.log(JSON.stringify({ stage: "starting", case: task.id }));
  try {
    const row = await run(task);
    rows.push(row);
    console.log(JSON.stringify({ stage: "scored", ...row, report: undefined }));
  } catch (error) {
    rows.push({
      id: task.id,
      expectedSpecialist: task.agentId,
      succeeded: false,
      quality: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
const summary = {
  label,
  runtime: runtimeDirectory,
  cases: rows.length,
  succeeded: rows.filter((row) => row.succeeded).length,
  specialistPrecision:
    rows.filter((row) => "specialistCorrect" in row && row.specialistCorrect).length /
    Math.max(rows.length, 1),
  meanQuality: rows.reduce((total, row) => total + row.quality, 0) / Math.max(rows.length, 1),
  rows,
};
const reportPath = join(
  repository,
  "packages/eval/.generated/model-comparison",
  `${label}-agent.json`,
);
await writeFile(reportPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ stage: "finished", ...summary, rows: undefined, reportPath }));
