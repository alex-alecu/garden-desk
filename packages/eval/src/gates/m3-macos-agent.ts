import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGardenDeskCore } from "@gardendesk/core";
import { MacOsMicroVmLauncher } from "@gardendesk/workers";
import { prepareAgentModelStore } from "./agent-model-store.js";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";
import { runGoldenTasks } from "./m3-golden-tasks.js";
import { runGuestEvidence } from "./m3-guest.js";

const repositoryRoot = process.cwd();
const helper = join(
  repositoryRoot,
  "packages/workers/native/macos-vz-helper/.generated/garden-desk-vz-helper",
);
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const visionRuntime = join(
  repositoryRoot,
  "packages/eval/.generated/vision/macos-arm64/llama-mtmd-cli",
);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The M3 macOS gate requires Apple silicon.");
}

const root = await mkdtemp(join(tmpdir(), "garden-desk-m3-agent-gate-"));
try {
  await prepareAgentModelStore(modelRoot);
  await runGuestEvidence(root, (workspace) => new MacOsMicroVmLauncher(helper, images, workspace));
  const core = await createGardenDeskCore({
    workspaceDir: join(root, "agent-workspace"),
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    workerEntryPath: developmentInferenceWorkerEntryPath(),
    visionRuntimePath: visionRuntime,
  });
  try {
    await runGoldenTasks(core, root);
  } finally {
    await core.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
