import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePackageCompliance } from "../package-compliance.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(): Promise<{ external: string; guest: string; resources: string }> {
  const root = await mkdtemp(join(tmpdir(), "vault-package-compliance-"));
  roots.push(root);
  const resources = join(root, "resources");
  const guest = join(root, "guest.json");
  const external = join(root, "model.gguf");
  await mkdir(join(resources, "inference", "node_modules"), { recursive: true });
  await writeFile(guest, JSON.stringify({ contents: [] }));
  await writeFile(external, "model");
  return { external, guest, resources };
}

describe("package compliance", () => {
  it("records an external model at its packaged path", async () => {
    const { external, guest, resources } = await fixture();
    await writePackageCompliance(resources, guest, [
      { source: external, path: "models/model.gguf" },
    ]);
    const manifest = JSON.parse(
      await readFile(join(resources, "resource-manifest.json"), "utf8"),
    ) as { files: Array<{ path: string; byteLength: number; sha256: string }> };
    expect(manifest.files).toContainEqual({
      path: "models/model.gguf",
      byteLength: 5,
      sha256: createHash("sha256").update("model").digest("hex"),
    });
  });

  it("rejects duplicate packaged paths", async () => {
    const { external, guest, resources } = await fixture();
    await mkdir(join(resources, "models"), { recursive: true });
    await writeFile(join(resources, "models", "model.gguf"), "staged");
    await expect(
      writePackageCompliance(resources, guest, [{ source: external, path: "models/model.gguf" }]),
    ).rejects.toThrow("duplicate models/model.gguf");
  });
});
