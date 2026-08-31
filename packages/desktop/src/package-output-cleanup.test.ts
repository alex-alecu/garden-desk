import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanModelCopies,
  cleanupDevelopmentModelOutput,
  type PackageBuildTarget,
  packageBuildTarget,
  prepareDevelopmentModelOutput,
  preparePackageBuild,
  rollbackPackageBuild,
} from "../package-output-cleanup.js";
import { generationModelFileName, projectorModelFileName } from "./package-model-contract.js";

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
  await writeFile(join(resources, "models", projectorModelFileName), "projector");
  await writeFile(
    join(resources, "resource-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      files: [
        [generationModelFileName, manifestModel],
        [projectorModelFileName, "projector"],
      ].map(([name, content]) => ({
        path: `models/${name}`,
        byteLength: Buffer.byteLength(content as string),
        sha256: createHash("sha256")
          .update(content as string)
          .digest("hex"),
      })),
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
  await writeFile(join(canonical, projectorModelFileName), "projector");
  return target;
}

describe("package output retention", () => {
  it("retains release and removes debug and intermediate model copies", async () => {
    const release = await macTarget("release");
    const debug = packageBuildTarget(release.desktopRoot, "darwin", "arm64", ["build", "--debug"]);
    if (debug === undefined) throw new Error("Expected debug package target.");
    await writePackage(release);
    await writePackage(debug);
    const legacyRoot = join(release.tauriRoot, "resources", "core", "models");
    const intermediateRoot = join(
      release.tauriRoot,
      "target",
      "release",
      "resources",
      "core",
      "models",
    );
    await mkdir(legacyRoot, { recursive: true });
    await mkdir(intermediateRoot, { recursive: true });
    for (const name of [generationModelFileName, projectorModelFileName]) {
      await writeFile(join(legacyRoot, name), "model");
      await writeFile(join(intermediateRoot, name), "model");
    }

    await cleanModelCopies(release);

    await expect(
      stat(join(resourcesRoot(release), "models", generationModelFileName)),
    ).resolves.toBeDefined();
    await expect(
      stat(join(resourcesRoot(release), "models", projectorModelFileName)),
    ).resolves.toBeDefined();
    await expect(stat(debug.packageRoot)).rejects.toMatchObject({ code: "ENOENT" });
    for (const name of [generationModelFileName, projectorModelFileName]) {
      await expect(stat(join(legacyRoot, name))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(intermediateRoot, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

describe("development model cleanup", () => {
  it("restores the transient development model pair before startup", async () => {
    const release = await macTarget("release");
    const repositoryRoot = resolve(release.desktopRoot, "../..");
    const modelRoot = join(
      release.desktopRoot,
      "src-tauri",
      "target",
      "debug",
      "resources",
      "core",
      "models",
    );
    await prepareDevelopmentModelOutput(release.desktopRoot, repositoryRoot);

    await expect(readFile(join(modelRoot, generationModelFileName), "utf8")).resolves.toBe("model");
    await expect(readFile(join(modelRoot, projectorModelFileName), "utf8")).resolves.toBe(
      "projector",
    );
  });

  it("removes the transient development model pair", async () => {
    const release = await macTarget("release");
    const modelRoot = join(
      release.desktopRoot,
      "src-tauri",
      "target",
      "debug",
      "resources",
      "core",
      "models",
    );
    await mkdir(modelRoot, { recursive: true });
    for (const name of [generationModelFileName, projectorModelFileName]) {
      await writeFile(join(modelRoot, name), "model");
    }

    await cleanupDevelopmentModelOutput(release.desktopRoot);

    for (const name of [generationModelFileName, projectorModelFileName]) {
      await expect(stat(join(modelRoot, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
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
      join(desktop, "src-tauri", "target", "release", "bundle", "windows", "Garden Desk"),
    );
  });
});
