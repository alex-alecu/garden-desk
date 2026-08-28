import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  totalmem: () => 8 * 1024 * 1024 * 1024,
}));

import { createVaultCore } from "../compose.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== "darwin")("8 GB Mac composition", () => {
  it("returns an unsupported model before opening a model store or worker", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "vault-unsupported-hardware-"));
    roots.push(workspaceDir);
    const core = await createVaultCore({
      workspaceDir,
      modelStoreDir: join(workspaceDir, "missing-model-store"),
      profile: "auto",
      workerEntryPath: join(workspaceDir, "missing-worker"),
      agentHelperPath: join(workspaceDir, "missing-agent-helper"),
    });
    try {
      await expect(core.modelStatus()).resolves.toMatchObject({
        state: "unsupported",
        message: "This Mac has 8 GB of memory. Garden Desk requires more memory to run locally.",
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
