import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEventInput } from "@vault/shared";
import { FakeInferenceWorker } from "@vault/workers";
import { afterEach, describe, expect, it } from "vitest";
import type { InferencePort } from "./inference.js";
import { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";
import { InferenceSupervisor } from "./supervisor.js";

const roots: string[] = [];
const GiB = 1024 * 1024 * 1024;
async function modelResolver(): Promise<ModelResolver> {
  const root = await mkdtemp(join(tmpdir(), "vault-m2-models-"));
  roots.push(root);
  const bytes = Buffer.from("model");
  await writeFile(join(root, "model.gguf"), bytes);
  await writeFile(
    join(root, "installed-models.json"),
    JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          modelId: "test-model",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          byteLength: bytes.length,
          runtimeBuild: "fake",
          storeKey: "model.gguf",
          installedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  return ModelResolver.open(root);
}
const generationInput = {
  modelId: "test-model",
  prompt: "ready",
  jsonSchema: { type: "object" },
  contextSize: 512,
  maxTokens: 8,
};

async function supervisor(port: InferencePort, events: AuditEventInput[]) {
  return new InferenceSupervisor(
    port,
    await modelResolver(),
    new ResourceScheduler(12 * GiB),
    (event) => events.push(event),
  );
}

function expectFailureAudit(events: AuditEventInput[], code: string) {
  expect(events).toMatchObject([
    { type: "inference.generate", outcome: "failed", metadata: { code } },
  ]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M2 inference orchestration", () => {
  it("resolves approved models, enforces profile memory, and audits generation", async () => {
    const events: AuditEventInput[] = [];
    const supervisor = new InferenceSupervisor(
      new FakeInferenceWorker(),
      await modelResolver(),
      new ResourceScheduler(12 * GiB),
      (event) => events.push(event),
    );
    const result = await supervisor.generate({
      modelId: "test-model",
      prompt: "ready",
      jsonSchema: { type: "object" },
      contextSize: 512,
      maxTokens: 8,
    });
    expect(result.value).toEqual({ result: "ready" });
    expect(result.memory.budgetBytes).toBe(12 * 1024 * 1024 * 1024);
    expect(events).toMatchObject([{ type: "inference.generate", outcome: "succeeded" }]);
  });

  it("rejects missing and modified models", async () => {
    const resolver = await modelResolver();
    await expect(resolver.resolve("missing")).rejects.toThrow("missing_model");
    const root = roots.at(-1);
    if (root === undefined) throw new Error("Missing test root.");
    await writeFile(join(root, "model.gguf"), "changed");
    await expect(resolver.resolve("test-model")).rejects.toThrow("model_integrity_failed");
  });

  it("keeps verified staged bytes stable when the store entry is replaced", async () => {
    const resolver = await modelResolver();
    const root = roots.at(-1);
    if (root === undefined) throw new Error("Missing test root.");
    const staged = await resolver.resolve("test-model");
    try {
      await rename(join(root, "model.gguf"), join(root, "original.gguf"));
      await writeFile(join(root, "model.gguf"), "replacement");
      expect(await readFile(staged.path)).toEqual(Buffer.from("model"));
    } finally {
      await staged.dispose();
    }
  });

  it("prevents overlapping generation and embedding reservations", () => {
    const scheduler = new ResourceScheduler(16 * GiB);
    const lease = scheduler.reserve("generate");
    expect(() => scheduler.reserve("embed")).toThrow("inference_memory_budget_exceeded");
    lease.release();
    expect(() => scheduler.reserve("embed")).not.toThrow();
  });
});

describe("M3 model residency", () => {
  it("keeps a successful model resident until manual unload", async () => {
    const events: AuditEventInput[] = [];
    const inference = await supervisor(new FakeInferenceWorker(), events);

    await inference.generate(generationInput);
    await inference.generate(generationInput);

    await expect(inference.modelStatus()).resolves.toMatchObject({
      state: "ready",
      memoryBudgetBytes: 12 * GiB,
      cpuRamBytes: 1024,
      gpuMemoryBytes: 2048,
      contextSizeTokens: 512,
      contextLimitTokens: 65_536,
      contextLimitReason: "certified_standard",
    });
    await expect(inference.unloadModel()).resolves.toBe(true);
    await expect(inference.modelStatus()).resolves.toMatchObject({ state: "unloaded" });
  });

  it("keeps the allocated context after unload and drops live allocation", async () => {
    const inference = await supervisor(new FakeInferenceWorker(), []);

    await inference.generate(generationInput);
    await expect(inference.unloadModel()).resolves.toBe(true);

    const status = await inference.modelStatus();
    expect(status).toMatchObject({
      state: "unloaded",
      contextSizeTokens: 512,
      contextLimitTokens: 65_536,
      contextLimitReason: "certified_standard",
    });
    expect(status.cpuRamBytes).toBeUndefined();
    expect(status.gpuMemoryBytes).toBeUndefined();
    expect(status.memoryBudgetBytes).toBeUndefined();
  });
});

describe("M2 model staging cancellation", () => {
  it("cancels before copying and hashing completes", async () => {
    const resolver = await modelResolver();
    const controller = new AbortController();
    const pending = resolver.resolve("test-model", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("M2 inference failure audit", () => {
  it.each([
    ["cancelled", 0, "ready"],
    ["timeout", 0, "ready"],
    ["malformed_worker_message", 1, "unloaded"],
    ["worker_crash", 1, "unloaded"],
  ] as const)("audits typed %s worker failures", async (code, expectedUnloads, expectedState) => {
    const events: AuditEventInput[] = [];
    let unloads = 0;
    const port: InferencePort = {
      async unload() {
        unloads += 1;
        return true;
      },
      async execute() {
        throw Object.assign(new Error(code), { code });
      },
    };
    const inference = await supervisor(port, events);
    await expect(inference.generate(generationInput)).rejects.toMatchObject({ code });
    expectFailureAudit(events, code);
    expect(unloads).toBe(expectedUnloads);
    await expect(inference.modelStatus()).resolves.toMatchObject({ state: expectedState });
  });
});

describe("M2 inference shutdown", () => {
  it("cancels and waits for active inference during supervisor shutdown", async () => {
    const events: AuditEventInput[] = [];
    let unloads = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((accept) => {
      markStarted = () => accept();
    });
    const port: InferencePort = {
      async unload() {
        unloads += 1;
        return true;
      },
      execute(execution) {
        markStarted();
        return new Promise((_accept, reject) => {
          const cancelled = () =>
            reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
          if (execution.signal?.aborted) cancelled();
          else execution.signal?.addEventListener("abort", cancelled, { once: true });
        });
      },
    };
    const inference = await supervisor(port, events);
    const pending = inference.generate(generationInput);
    await started;
    const closing = inference.close();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await closing;
    expectFailureAudit(events, "cancelled");
    expect(unloads).toBeGreaterThan(0);
  });
});

describe("M2 inference response validation", () => {
  it("audits out-of-memory responses and rejects operation mismatches before success", async () => {
    const events: AuditEventInput[] = [];
    const responses = [
      {
        protocolVersion: 2 as const,
        requestId: "first",
        status: "error" as const,
        error: { code: "out_of_memory" as const, message: "allocation failed" },
      },
      {
        protocolVersion: 2 as const,
        requestId: "second",
        status: "ok" as const,
        operation: "embed" as const,
        vector: [1],
        memory: {
          cpuRamBytes: 1,
          gpuMemoryBytes: 1,
          budgetBytes: 1,
          detectedGpuMemoryBytes: 1,
          gpuMemoryKind: "unified" as const,
          backend: "metal" as const,
          selectedDeviceCount: 1 as const,
        },
      },
    ];
    const port: InferencePort = {
      async unload() {
        return true;
      },
      async execute(execution) {
        const response = responses.shift();
        if (response === undefined) throw new Error("Missing test response.");
        return { ...response, requestId: execution.request.requestId };
      },
    };
    const inference = await supervisor(port, events);
    await expect(inference.generate(generationInput)).rejects.toMatchObject({
      code: "out_of_memory",
    });
    await expect(inference.generate(generationInput)).rejects.toMatchObject({
      code: "malformed_worker_message",
    });
    expect(events).toMatchObject([
      { outcome: "failed", metadata: { code: "out_of_memory" } },
      { outcome: "failed", metadata: { code: "malformed_worker_message" } },
    ]);
  });
});
