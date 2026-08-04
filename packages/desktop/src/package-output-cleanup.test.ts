import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanModelCopies,
  cleanupDevelopmentModelOutput,
  type PackageBuildTarget,
  packageBuildTarget,
  preparePackageBuild,
  rollbackPackageBuild,
} from "../package-output-cleanup.js";
import { generationModelFileName } from "./package-model-contract.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function resourcesRoot(target: PackageBuildTarget): string {
  return target.platform === "darwin"
    ? join(target.packageRoot, "Contents", "Resources", "resources", "core")
    : join(target.packageRoot, "resources", "core");
}

async function writePackage(
  target: PackageBuildTarget,
  model = "model",
  manifestModel = model,
): Promise<void> {
  const resources = resourcesRoot(target);
  await mkdir(join(resources, "models"), { recursive: true });
  await writeFile(join(resources, "models", generationModelFileName), model);
  await writeFile(
    join(resources, "resource-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      files: [
        {
          path: `models/${generationModelFileName}`,
          byteLength: Buffer.byteLength(manifestModel),
          sha256: createHash("sha256").update(manifestModel).digest("hex"),
        },
      ],
    }),
  );
}

async function macTarget(profile: "debug" | "release"): Promise<PackageBuildTarget> {
  const root = await mkdtemp(join(tmpdir(), "vault-package-cleanup-"));
  roots.push(root);
  const target = packageBuildTarget(
    join(root, "packages", "desktop"),
    "darwin",
    "arm64",
    profile === "debug" ? ["build", "--debug"] : ["build"],
  );
  if (target === undefined) throw new Error("Expected macOS package target.");
  const canonical = join(root, "packages", "eval", ".generated", "models");
  await mkdir(canonical, { recursive: true });
  await writeFile(join(canonical, generationModelFileName), "model");
  return target;
}

describe("package output retention", () => {
  it("retains release and removes debug and intermediate model copies", async () => {
    const release = await macTarget("release");
    const debug = packageBuildTarget(release.desktopRoot, "darwin", "arm64", ["build", "--debug"]);
    if (debug === undefined) throw new Error("Expected debug package target.");
    await writePackage(release);
    await writePackage(debug);
    const legacy = join(release.tauriRoot, "resources", "core", "models", generationModelFileName);
    const intermediate = join(
      release.tauriRoot,
      "target",
      "release",
      "resources",
      "core",
      "models",
      generationModelFileName,
    );
    await mkdir(join(legacy, ".."), { recursive: true });
    await mkdir(join(intermediate, ".."), { recursive: true });
    await writeFile(legacy, "model");
    await writeFile(intermediate, "model");

    await cleanModelCopies(release);

    await expect(
      stat(join(resourcesRoot(release), "models", generationModelFileName)),
    ).resolves.toBeDefined();
    await expect(stat(debug.packageRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(intermediate)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("development model cleanup", () => {
  it("removes the transient development model", async () => {
    const release = await macTarget("release");
    const model = join(
      release.desktopRoot,
      "src-tauri",
      "target",
      "debug",
      "resources",
      "core",
      "models",
      generationModelFileName,
    );
    await mkdir(join(model, ".."), { recursive: true });
    await writeFile(model, "model");

    await cleanupDevelopmentModelOutput(release.desktopRoot);

    await expect(stat(model)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("package output safety", () => {
  it("does not remove the previous package when verification fails", async () => {
    const release = await macTarget("release");
    const debug = packageBuildTarget(release.desktopRoot, "darwin", "arm64", ["build", "--debug"]);
    if (debug === undefined) throw new Error("Expected debug package target.");
    await writePackage(release, "corrupt", "expected");
    await writePackage(debug);

    await expect(cleanModelCopies(release)).rejects.toThrow("does not match");
    await expect(stat(debug.packageRoot)).resolves.toBeDefined();
  });

  it("restores the prior package after a failed replacement", async () => {
    const release = await macTarget("release");
    await writePackage(release, "previous");
    expect(await preparePackageBuild(release)).toBe(true);
    expect(await preparePackageBuild(release)).toBe(true);
    await writePackage(release, "partial");

    await rollbackPackageBuild(release, true);

    expect(
      await readFile(join(resourcesRoot(release), "models", generationModelFileName), "utf8"),
    ).toBe("previous");
  });

  it("selects only supported package outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-package-target-"));
    roots.push(root);
    const desktop = join(root, "packages", "desktop");
    expect(
      packageBuildTarget(desktop, "darwin", "arm64", ["build", "--no-bundle"]),
    ).toBeUndefined();
    expect(packageBuildTarget(desktop, "win32", "x64", ["build", "--debug"])).toBeUndefined();
    expect(packageBuildTarget(desktop, "win32", "x64", ["build"])?.packageRoot).toBe(
      join(desktop, "src-tauri", "target", "release", "bundle", "windows", "Vault Desk"),
    );
  });
});
