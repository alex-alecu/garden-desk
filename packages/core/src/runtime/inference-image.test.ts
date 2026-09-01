import { createHash } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: isolated image fixtures use temporary files.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEventInput } from "@gardendesk/shared";
import { FakeInferenceWorker } from "@gardendesk/workers";
import { afterEach, describe, expect, it } from "vitest";
import { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";
import { InferenceSupervisor } from "./supervisor.js";

const roots: string[] = [];
const GiB = 1024 * 1024 * 1024;
const generationInput = {
  modelId: "test-model",
  prompt: "ready",
  jsonSchema: { type: "object" },
  contextSize: 512,
  maxTokens: 8,
};

async function modelResolver(): Promise<ModelResolver> {
  const root = await mkdtemp(join(tmpdir(), "garden-desk-image-models-"));
  roots.push(root);
  const bytes = Buffer.from("model");
  await writeFile(join(root, "model.gguf"), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(
    join(root, "installed-models.json"),
    JSON.stringify({
      schemaVersion: 1,
      models: ["test-model", "test-projector"].map((modelId) => ({
        modelId,
        sha256,
        byteLength: bytes.length,
        runtimeBuild: "fake",
        storeKey: "model.gguf",
        installedAt: new Date().toISOString(),
      })),
    }),
  );
  return ModelResolver.open(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M3 image inference residency", () => {
  it("unloads chat inference, stages the model pair, and audits one image", async () => {
    const events: AuditEventInput[] = [];
    const imageRoot = await mkdtemp(join(tmpdir(), "garden-desk-image-inference-"));
    roots.push(imageRoot);
    const imagePath = join(imageRoot, "image.png");
    await writeFile(imagePath, "image");
    const inference = new InferenceSupervisor(
      new FakeInferenceWorker(),
      await modelResolver(),
      new ResourceScheduler(12 * GiB),
      (event) => events.push(event),
      {
        async inspect(execution) {
          expect(await readFile(execution.modelPath, "utf8")).toBe("model");
          expect(await readFile(execution.projectorPath, "utf8")).toBe("model");
          expect(execution.imagePath).toBe(imagePath);
          return { text: "Image facts." };
        },
      },
    );
    await inference.generate(generationInput);
    await expect(
      inference.inspectImage({
        imagePath,
        modelId: "test-model",
        projectorModelId: "test-projector",
        prompt: "Inspect it.",
      }),
    ).resolves.toBe("Image facts.");
    await expect(inference.modelStatus()).resolves.toMatchObject({ state: "unloaded" });
    expect(events.map((event) => event.type)).toEqual(["inference.generate", "inference.vision"]);
  });
});

describe("M3 image inference cleanup", () => {
  it("releases the memory lease when staged cleanup fails", async () => {
    const events: AuditEventInput[] = [];
    const scheduler = new ResourceScheduler(12 * GiB);
    const disposeOrder: number[] = [];
    let resolveCount = 0;
    const models = {
      async resolve() {
        const index = resolveCount++;
        return {
          path: `/tmp/model-${index}.gguf`,
          async dispose() {
            disposeOrder.push(index);
            if (index === 1) throw new Error("projector_cleanup_failed");
          },
        };
      },
    } as unknown as ModelResolver;
    const inference = new InferenceSupervisor(
      new FakeInferenceWorker(),
      models,
      scheduler,
      (event) => events.push(event),
      {
        async inspect() {
          return { text: "Image facts." };
        },
      },
    );
    await expect(
      inference.inspectImage({
        imagePath: "/tmp/image.png",
        modelId: "test-model",
        projectorModelId: "test-projector",
        prompt: "Inspect it.",
      }),
    ).rejects.toThrow("projector_cleanup_failed");
    scheduler.reserve("generate").release();
    expect(disposeOrder).toEqual([1, 0]);
    expect(events).toMatchObject([{ type: "inference.vision", outcome: "failed" }]);
  });
});
