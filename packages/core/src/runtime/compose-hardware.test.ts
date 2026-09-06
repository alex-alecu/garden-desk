import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditLog } from "../audit/log.js";
import { createInferenceService } from "./compose.js";
import { initializeEmptyModelStore } from "./models.js";

const hardware = vi.hoisted(() => ({
  memoryBytes: 8 * 1024 ** 3,
  windowsRuntime: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  totalmem: () => hardware.memoryBytes,
}));
vi.mock("@gardendesk/workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gardendesk/workers")>()),
  createWindowsInferenceRuntime: hardware.windowsRuntime,
}));

import { createGardenDeskCore } from "../compose.js";

const roots: string[] = [];

afterEach(async () => {
  hardware.memoryBytes = 8 * 1024 ** 3;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.skipIf(process.platform !== "win32")(
  "returns unsupported when Windows host memory cannot hold one agent session",
  async () => {
    hardware.memoryBytes = 24 * 1024 ** 3;
    hardware.windowsRuntime.mockResolvedValue({
      hardwareProfile: {
        memoryBudgetBytes: 16 * 1024 ** 3,
        hostMemoryReservationBytes: 20 * 1024 ** 3,
      },
      workerEntryPath: "unused",
      workerLauncher: { launch: vi.fn() },
    });
    const workspaceDir = await mkdtemp(join(tmpdir(), "garden-desk-unsupported-hardware-"));
    roots.push(workspaceDir);
    const modelStoreDir = join(workspaceDir, "models");
    await initializeEmptyModelStore(modelStoreDir);
    const configured = await createInferenceService(
      { modelStoreDir, profile: "auto" },
      workspaceDir,
      {} as AuditLog,
    );
    try {
      expect(configured.available).toBe(false);
      expect(configured.agentSessionCapacity).toBe(0);
      await expect(configured.service.modelStatus()).resolves.toMatchObject({
        state: "unsupported",
        message: "This computer does not have enough memory to run Garden Desk.",
      });
    } finally {
      await configured.service.close();
    }
  },
);

describe.skipIf(process.platform !== "darwin")("8 GB Mac composition", () => {
  it("returns an unsupported model before opening a model store or worker", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "garden-desk-unsupported-hardware-"));
    roots.push(workspaceDir);
    const core = await createGardenDeskCore({
      workspaceDir,
      modelStoreDir: join(workspaceDir, "missing-model-store"),
      profile: "auto",
      workerEntryPath: join(workspaceDir, "missing-worker"),
      agentHelperPath: join(workspaceDir, "missing-agent-helper"),
    });
    try {
      await expect(core.modelStatus()).resolves.toMatchObject({
        state: "unsupported",
        message: "Garden Desk requires a Mac with at least 24 GB of memory.",
      });
      await expect(
        core.generate({
          modelId: "gemma-4-12b-it-qat-q4_0",
          prompt: "Do not run.",
          jsonSchema: { type: "object" },
          contextSize: "auto",
          maxTokens: 1,
        }),
      ).rejects.toMatchObject({ code: "unsupported" });
    } finally {
      await core.close();
    }
  });
});
