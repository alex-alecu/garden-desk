// biome-ignore lint/style/noRestrictedImports: This test writes a fixed private marker.
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceWorkerRequestSchema } from "@gardendesk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "../native/launcher.js";

const diagnostics = vi.hoisted(() => ({
  record: async (..._arguments: unknown[]): Promise<void> => undefined,
}));

vi.mock("./development-diagnostics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./development-diagnostics.js")>()),
  recordDevelopmentHostFailure: (...arguments_: unknown[]) => diagnostics.record(...arguments_),
}));

import { InferenceWorkerClient } from "./client.js";
import { waitForDevelopmentHostRecord } from "./development-host-record-wait.js";

const PRIVATE_SENTINEL = "private-launch-record-sentinel";
const roots: string[] = [];
const request = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "host-record",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "chat",
  modelId: "test-model",
  messages: [{ role: "user", text: "Test." }],
  tools: [],
  contextSize: 512,
  maxTokens: 1,
  temperature: 0,
});

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

class FailingLauncher implements NativeWorkerLauncher {
  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    throw new Error(PRIVATE_SENTINEL);
  }
}

async function launchFailure(): Promise<unknown> {
  try {
    await new InferenceWorkerClient(new FailingLauncher(), "unused").execute({
      request,
      memoryBudgetBytes: 1_024,
      timeoutMs: 1_000,
    });
  } catch (error) {
    return error;
  }
  throw new Error("launch failure did not reject");
}

function expectSafeLaunchFailure(error: unknown): void {
  expect(error).toMatchObject({ code: "worker_crash", message: "Inference worker stopped." });
  expect(String((error as Error).message)).not.toContain(PRIVATE_SENTINEL);
}

afterEach(async () => {
  vi.useRealTimers();
  diagnostics.record = async (..._arguments: unknown[]): Promise<void> => undefined;
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { force: true, recursive: true })),
  );
});

describe("development host launch recording", () => {
  it("persists a quick private record before the fixed safe error", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-host-launch-record-"));
    roots.push(root);
    const marker = join(root, "persisted");
    const restore = enableDevelopmentBuild();
    diagnostics.record = async (..._arguments: unknown[]) => {
      await writeFile(marker, PRIVATE_SENTINEL);
    };
    try {
      expectSafeLaunchFailure(await launchFailure());
      await expect(stat(marker)).resolves.toBeDefined();
    } finally {
      restore();
    }
  });

  it("swallows a private record failure", async () => {
    const restore = enableDevelopmentBuild();
    diagnostics.record = async (..._arguments: unknown[]) => {
      throw new Error(PRIVATE_SENTINEL);
    };
    try {
      expectSafeLaunchFailure(await launchFailure());
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
      const pending = launchFailure();
      await started.promise;
      await vi.advanceTimersToNextTimerAsync();
      expectSafeLaunchFailure(await pending);
    } finally {
      restore();
    }
  });

  it("clears the timer after a quick record", async () => {
    vi.useFakeTimers();
    await waitForDevelopmentHostRecord(Promise.resolve(), 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
