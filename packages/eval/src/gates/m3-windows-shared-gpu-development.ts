import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { InferenceWorkerRequestSchema } from "@vault/shared";
import { InferenceWorkerClient, WindowsNativeWorkerLauncher } from "@vault/workers";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";
import { windowsInferencePaths } from "./windows-inference.js";

const GiB = 1024 * 1024 * 1024;
const generationModelId = "gemma-4-12b-it-qat-q4_0";
const memoryBudgetBytes = 12 * GiB;
const contextSize = 8_192;
const maxTokens = 10;
const timeoutMs = 60 * 60 * 1_000;
const totalMemoryBytes = totalmem();
const modelPath = join(
  process.cwd(),
  "packages/eval/.generated/models",
  `${generationModelId}.gguf`,
);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The shared-GPU development probe requires Windows x64.");
}
if (totalMemoryBytes < memoryBudgetBytes + 8 * GiB) {
  throw new Error("The shared-GPU development probe requires at least 20 GiB of usable RAM.");
}

const manifest = await readCanonicalModelManifest();
const model = manifest.models.find((candidate) => candidate.id === generationModelId);
if (model === undefined) throw new Error(`Canonical model is missing: ${generationModelId}`);
await verifyModelFile(model, modelPath);

const inference = await windowsInferencePaths({ preferDevelopmentResources: true });
const client = new InferenceWorkerClient(
  new WindowsNativeWorkerLauncher(inference.inferenceHelperPath, inference.inferenceRuntimePath, {
    developmentAllowSharedGpu: true,
  }),
  inference.workerEntryPath,
);
const responseDeltas: string[] = [];

async function runProbe() {
  try {
    return await client.execute({
      request: InferenceWorkerRequestSchema.parse({
        protocolVersion: 1,
        requestId: randomUUID(),
        jobId: randomUUID(),
        operation: "chat",
        modelId: generationModelId,
        messages: [
          { role: "system", text: "Do not think. Reply only with OK." },
          { role: "user", text: "Reply now." },
        ],
        tools: [],
        contextSize,
        maxTokens,
        temperature: 0,
      }),
      modelPath,
      memoryBudgetBytes,
      timeoutMs,
      onResponseDelta: (text) => responseDeltas.push(text),
    });
  } finally {
    await client.unload();
  }
}

const response = await runProbe();
if (response.status === "error") {
  throw new Error(`${response.error.code}: ${response.error.message}`);
}
if (response.operation !== "chat" || response.text.trim().length === 0) {
  throw new Error("The shared-GPU development probe returned no response text.");
}
if (
  response.memory.budgetBytes > memoryBudgetBytes ||
  response.memory.contextSizeTokens !== contextSize ||
  response.performance.outputTokens > maxTokens
) {
  throw new Error(`The shared-GPU development bounds failed: ${JSON.stringify(response)}`);
}
const report = {
  schemaVersion: 1,
  certification: false,
  developmentSharedGpuOverride: true,
  platform: process.platform,
  architecture: process.arch,
  totalMemoryBytes,
  runtimeBuild: "node-llama-cpp@3.19.0",
  limits: { memoryBudgetBytes, contextSize, maxTokens, timeoutMs },
  text: response.text,
  streamedText: responseDeltas.join(""),
  stopReason: response.stopReason,
  memory: response.memory,
  performance: response.performance,
  cleanShutdown: true,
};
const reportRoot = join(process.cwd(), "packages/eval/.generated/reports");
await mkdir(reportRoot, { recursive: true });
await writeFile(
  join(reportRoot, "m3-windows-shared-gpu-development.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
