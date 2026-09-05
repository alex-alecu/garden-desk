import { randomUUID } from "node:crypto";
import { JobIdSchema } from "@gardendesk/shared";
import {
  createWindowsInferenceRuntime,
  InferenceWorkerClient,
  MacOsNativeWorkerLauncher,
} from "@gardendesk/workers";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

const index = process.argv.indexOf("--model");
const path = process.argv[index + 1];
if (index < 0 || path === undefined)
  throw new Error("Pass --model <path> for the pinned embedding model.");
const asset = (await readCanonicalModelManifest()).models.find(
  (model) => model.role === "embedding",
);
if (asset === undefined) throw new Error("Canonical embedding asset is missing.");
await verifyModelFile(asset, path);
const windows = process.platform === "win32" ? await createWindowsInferenceRuntime({}) : undefined;
const client = new InferenceWorkerClient(
  windows?.workerLauncher ?? new MacOsNativeWorkerLauncher(),
  "",
);
try {
  const result = await client.execute({
    request: {
      protocolVersion: 2,
      requestId: randomUUID(),
      jobId: JobIdSchema.parse(randomUUID()),
      operation: "embed",
      modelId: asset.id,
      input: "Garden Desk offline retrieval smoke",
      contextSize: 512,
    },
    modelPath: path,
    memoryBudgetBytes: 2 * 1024 ** 3,
    timeoutMs: 300_000,
  });
  if (result.status !== "ok" || result.operation !== "embed") throw new Error("Embedding failed.");
  console.log(JSON.stringify({ modelId: asset.id, dimensions: result.vector.length }));
} finally {
  await client.unload();
}
