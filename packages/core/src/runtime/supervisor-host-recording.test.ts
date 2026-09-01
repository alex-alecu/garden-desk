// biome-ignore lint/style/noRestrictedImports: This test writes a fixed private marker.
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferencePort } from "./inference.js";
import type { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";

const diagnostics = vi.hoisted(() => ({
  record: async (..._arguments: unknown[]): Promise<void> => undefined,
}));

vi.mock("@gardendesk/workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gardendesk/workers")>()),
  recordDevelopmentHostFailure: (...arguments_: unknown[]) => diagnostics.record(...arguments_),
}));

import { InferenceSupervisor } from "./supervisor.js";

const GiB = 1024 ** 3;
const PRIVATE_SENTINEL = "private-model-record-sentinel";
const roots: string[] = [];
const input = {
  modelId: "test-model",
  prompt: "Test.",
  jsonSchema: { type: "object" },
  contextSize: 512,
  maxTokens: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function enableDevelopmentBuild(): () => void {
  const globals = globalThis as typeof globalThis & { __GARDEN_DESK_DEVELOPMENT_BUILD__?: boolean };
  const previous = globals.__GARDEN_DESK_DEVELOPMENT_BUILD__;
  globals.__GARDEN_DESK_DEVELOPMENT_BUILD__ = true;
  return () => {
    if (previous === undefined) delete globals.__GARDEN_DESK_DEVELOPMENT_BUILD__;
    else globals.__GARDEN_DESK_DEVELOPMENT_BUILD__ = previous;
  };
}

function failingModels(): ModelResolver {
  return {
    async resolve() {
      throw new Error(PRIVATE_SENTINEL);
    },
  } as unknown as ModelResolver;
}

function port(): InferencePort {
  return {
    async unload() {
      return false;
    },
    async execute() {
      throw new Error("unexpected worker execution");
    },
  };
}

async function modelFailure(): Promise<unknown> {
  const supervisor = new InferenceSupervisor(
    port(),
    failingModels(),
    new ResourceScheduler(12 * GiB),
    () => {},
  );
  try {
    await supervisor.generate(input);
  } catch (error) {
    return error;
  }
  throw new Error("model preparation did not reject");
}

function expectSafeModelFailure(error: unknown): void {
  expect(error).toMatchObject({ code: "internal", message: "Inference failed." });
  expect(String((error as Error).message)).not.toContain(PRIVATE_SENTINEL);
}

afterEach(async () => {
  vi.useRealTimers();
  diagnostics.record = async (..._arguments: unknown[]): Promise<void> => undefined;
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

describe("development host model recording", () => {
  it("persists a quick private record before the fixed safe error", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-host-model-record-"));
    roots.push(root);
    const marker = join(root, "persisted");
    const restore = enableDevelopmentBuild();
    diagnostics.record = async (..._arguments: unknown[]) => {
      await writeFile(marker, PRIVATE_SENTINEL);
    };
    try {
      expectSafeModelFailure(await modelFailure());
      await expect(stat(marker)).resolves.toBeDefined();
    } finally {
      restore();
    }
  });

  it("returns the fixed safe error after the bounded wait", async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const restore = enableDevelopmentBuild();
    diagnostics.record = async (..._arguments: unknown[]) => {
      started.resolve();
      await new Promise<void>(() => {});
    };
    try {
      const pending = modelFailure();
      await started.promise;
      await vi.advanceTimersToNextTimerAsync();
      expectSafeModelFailure(await pending);
    } finally {
      restore();
    }
  });
});
