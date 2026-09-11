import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGardenDeskCore, type GardenDeskCore } from "@gardendesk/core";
import type { AgentRunSnapshot } from "@gardendesk/shared";
import { prepareAgentModelStore } from "../gates/agent-model-store.js";
import { cases as obligations } from "./specialist-contract-obligations.js";
import { cases as comparison } from "./specialist-document-comparison.js";
import { cases as brief } from "./specialist-evidence-brief.js";
import { cases as reconciliation } from "./specialist-financial-reconciliation.js";
import { cases as extraction } from "./specialist-financial-record-extraction.js";
import { prepareSpecialistFiles, type SpecialistCase } from "./specialist-fixtures.js";
import { cases as intake } from "./specialist-folder-intake.js";
import { cases as expenses } from "./specialist-invoice-expense-review.js";
import { cases as chronology } from "./specialist-matter-chronology.js";

const cases = [
  ...intake,
  ...chronology,
  ...obligations,
  ...comparison,
  ...extraction,
  ...reconciliation,
  ...expenses,
  ...brief,
];
const repository = process.cwd();

async function openCore(root: string): Promise<GardenDeskCore> {
  const modelStoreDir = join(repository, "packages/eval/.generated/models");
  await prepareAgentModelStore(modelStoreDir);
  return createGardenDeskCore({
    workspaceDir: join(root, "state"),
    modelStoreDir,
    profile: "auto",
    migrationDirectory: join(repository, "packages/core/src/workspace/migrations"),
    promptDirectory: join(repository, "prompts"),
    workerEntryPath: "",
    inferenceHelperPath: join(
      repository,
      "packages/workers/native/windows-appcontainer-launcher/.generated/garden-desk-appcontainer-launcher.exe",
    ),
    inferenceRuntimePath: join(
      repository,
      "packages/eval/.generated/inference/windows-cuda-x64/llama-server.exe",
    ),
    agentHelperPath: join(
      repository,
      "packages/workers/native/windows-hcs-helper/.generated/garden-desk-hcs-helper.exe",
    ),
    agentImageRoot: join(repository, "packages/workers/images"),
  });
}

async function terminal(
  core: GardenDeskCore,
  runId: string,
  jobId: string,
): Promise<AgentRunSnapshot> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const snapshot = await core.getAgentRun(runId);
    if (snapshot.question !== null) {
      await core.cancelAgent(jobId);
      throw new Error("The case needs an unexpected user answer.");
    }
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await core.cancelAgent(jobId);
  throw new Error("The case exceeded its 10-minute limit.");
}

async function inspectReport(
  core: GardenDeskCore,
  task: SpecialistCase,
  snapshot: AgentRunSnapshot,
): Promise<void> {
  assert.equal(snapshot.run.state, "succeeded", snapshot.run.error ?? "Task did not succeed.");
  assert.ok(
    snapshot.childRuns.some(
      (child) => child.agentId === task.agentId && child.state === "succeeded",
    ),
    "Requested specialist did not complete.",
  );
  const artifact = snapshot.artifacts.find((item) => item.name === "result.md");
  assert.ok(artifact, "The requested result.md is missing.");
  const report = await readFile(
    await core.materializeArtifact(snapshot.run.sessionId, artifact.id),
    "utf8",
  );
  for (const file of task.sources)
    assert.ok(report.includes(file), `Source reference is missing: ${file}`);
  console.log(JSON.stringify({ case: task.id, expectedFacts: task.expected, report }));
}

async function run(task: SpecialistCase): Promise<void> {
  const root = await mkdtemp(join(repository, `packages/eval/.generated/${task.id}-`));
  const source = join(root, "source");
  await prepareSpecialistFiles(source, task.files);
  const core = await openCore(root);
  try {
    const folder = await core.addFolder(source);
    await prepareSpecialistFiles(source, task.addedAfterGrant ?? {});
    const session = await core.createSession(folder.id);
    const selection = task.command
      ? `/${task.command}`
      : `Use the ${task.agentId} specialist for this work.`;
    const prompt = `${selection}\n${task.request}\nUse the source files in /source. Write a concise final report to /workspace/result.md with the facts requested and source file references with page, paragraph, or row locations. Return a short summary. Do not change the source files.`;
    console.log(JSON.stringify({ case: task.id, stage: "starting", root }));
    const started = await core.startAgent(session.id, prompt);
    await inspectReport(core, task, await terminal(core, started.id, started.jobId));
  } finally {
    await core.close();
  }
}

assert.ok(
  process.platform === "win32" && process.arch === "x64",
  "This case runner requires Windows x64 and Hyper-V.",
);
const selected = cases.find((item) => item.id === process.argv[2]);
assert.ok(selected, `Select one case: ${cases.map((item) => item.id).join(", ")}`);
await run(selected);
