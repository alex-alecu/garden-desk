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

const antiword = {
  name: "Antiword",
  version: "0.37-17",
  license: "GPL-2.0-or-later",
  source: { file: "antiword.tar.gz", url: "https://example.test/antiword", sha256: "a".repeat(64) },
  patches: { file: "patches.tar.xz", url: "https://example.test/patches", sha256: "b".repeat(64) },
  notice: "/usr/share/licenses/antiword/COPYING",
  installedBytes: { aarch64: 123, x86_64: 124 },
  runtimeBytes: { aarch64: 100, x86_64: 101 },
  purpose: "legacy DOC plain-text reading",
};

describe("package compliance dependency records", () => {
  it("records the Windows DXCore binding on Windows", async () => {
    const { guest, resources } = await fixture();
    await writePackageCompliance(resources, guest);
    const notices = JSON.parse(
      await readFile(join(resources, "THIRD_PARTY_NOTICES.json"), "utf8"),
    ) as { packages: Array<{ name: string; version: string }> };
    const dependency = notices.packages.find(({ name }) => name === "Microsoft windows-rs");
    if (process.platform === "win32") {
      expect(dependency).toEqual({
        name: "Microsoft windows-rs",
        version: "0.61.3",
        license: "MIT OR Apache-2.0",
        purpose: "DXCore GPU and installed-memory discovery in the Windows inference helper",
      });
    } else {
      expect(dependency).toBeUndefined();
    }
  });
});

describe("package compliance manifests", () => {
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

  it("records guest source, patches, notice, size, and purpose", async () => {
    const { guest, resources } = await fixture();
    await writeFile(guest, JSON.stringify({ contents: [antiword] }));
    await writePackageCompliance(resources, guest);
    const notices = JSON.parse(
      await readFile(join(resources, "THIRD_PARTY_NOTICES.json"), "utf8"),
    ) as { packages: unknown[] };
    const sbom = JSON.parse(await readFile(join(resources, "sbom.spdx.json"), "utf8")) as {
      packages: Array<{ name: string; comment: string; downloadLocation: string }>;
    };
    expect(notices.packages).toContainEqual(antiword);
    expect(sbom.packages.find(({ name }) => name === "Antiword")).toMatchObject({
      downloadLocation: antiword.source.url,
      comment: expect.stringContaining('"installedBytes":{"aarch64":123'),
    });
    expect(sbom.packages.find(({ name }) => name === "Antiword")?.comment).toContain(
      '"runtimeBytes":{"aarch64":100',
    );
  });
});
