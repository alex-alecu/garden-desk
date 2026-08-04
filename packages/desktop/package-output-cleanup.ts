import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  canonicalGenerationModelPath,
  generationModelFileName,
  generationModelResourcePath,
  packagedGenerationModelPath,
} from "./src/package-model-contract.js";

export type PackageProfile = "debug" | "release";

export interface PackageBuildTarget {
  desktopRoot: string;
  packageRoot: string;
  platform: NodeJS.Platform;
  profile: PackageProfile;
  tauriRoot: string;
}

function macPackageRoot(tauriRoot: string, profile: PackageProfile): string {
  return join(tauriRoot, "target", profile, "bundle", "macos", "Vault Desk.app");
}

function windowsPackageRoot(tauriRoot: string): string {
  return join(tauriRoot, "target", "release", "bundle", "windows", "Vault Desk");
}

export function packageBuildTarget(
  desktopRoot: string,
  platform: NodeJS.Platform,
  architecture: string,
  tauriArguments: string[],
): PackageBuildTarget | undefined {
  if (tauriArguments[0] !== "build") return undefined;
  const tauriRoot = join(desktopRoot, "src-tauri");
  const profile = tauriArguments.includes("--debug") ? "debug" : "release";
  if (platform === "darwin" && architecture === "arm64") {
    if (tauriArguments.includes("--no-bundle")) return undefined;
    return {
      desktopRoot,
      packageRoot: macPackageRoot(tauriRoot, profile),
      platform,
      profile,
      tauriRoot,
    };
  }
  if (platform === "win32" && architecture === "x64" && profile === "release") {
    return {
      desktopRoot,
      packageRoot: windowsPackageRoot(tauriRoot),
      platform,
      profile,
      tauriRoot,
    };
  }
  return undefined;
}

function packageResourcesRoot(packageRoot: string, platform: NodeJS.Platform): string {
  return platform === "darwin"
    ? join(packageRoot, "Contents", "Resources", "resources", "core")
    : join(packageRoot, "resources", "core");
}

function backupRoot(target: PackageBuildTarget): string {
  return `${target.packageRoot}.previous`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((accept, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", accept);
  });
  return digest.digest("hex");
}

async function verifyPackage(target: PackageBuildTarget): Promise<void> {
  const resourcesRoot = packageResourcesRoot(target.packageRoot, target.platform);
  const manifest = JSON.parse(
    await readFile(join(resourcesRoot, "resource-manifest.json"), "utf8"),
  ) as { files?: Array<{ path?: string; byteLength?: number; sha256?: string }> };
  const matches = (manifest.files ?? []).filter(
    (entry) => entry.path === generationModelResourcePath,
  );
  if (matches.length !== 1)
    throw new Error("Packaged model manifest entry is missing or duplicated.");
  const entry = matches[0];
  const model = packagedGenerationModelPath(resourcesRoot);
  const canonical = canonicalGenerationModelPath(resolve(target.desktopRoot, "../.."));
  const [metadata, canonicalMetadata, modelHash, canonicalHash] = await Promise.all([
    stat(model),
    stat(canonical),
    sha256(model),
    sha256(canonical),
  ]);
  if (
    entry?.byteLength !== metadata.size ||
    entry.byteLength !== canonicalMetadata.size ||
    entry.sha256 !== modelHash ||
    entry.sha256 !== canonicalHash
  ) {
    throw new Error("Packaged model does not match its resource manifest.");
  }
}

async function modelFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await modelFiles(path)));
    else if (entry.isFile() && entry.name === generationModelFileName) output.push(path);
  }
  return output;
}

function knownModelPaths(target: PackageBuildTarget): Set<string> {
  const paths = new Set([
    join(target.tauriRoot, "resources", "core", "models", generationModelFileName),
    join(
      target.tauriRoot,
      "target",
      "debug",
      "resources",
      "core",
      "models",
      generationModelFileName,
    ),
    join(
      target.tauriRoot,
      "target",
      "release",
      "resources",
      "core",
      "models",
      generationModelFileName,
    ),
    packagedGenerationModelPath(packageResourcesRoot(target.packageRoot, target.platform)),
    packagedGenerationModelPath(packageResourcesRoot(backupRoot(target), target.platform)),
  ]);
  if (target.platform === "darwin") {
    for (const profile of ["debug", "release"] as const) {
      paths.add(
        packagedGenerationModelPath(
          packageResourcesRoot(macPackageRoot(target.tauriRoot, profile), target.platform),
        ),
      );
    }
  } else {
    paths.add(
      packagedGenerationModelPath(
        packageResourcesRoot(windowsPackageRoot(target.tauriRoot), target.platform),
      ),
    );
  }
  return paths;
}

async function rejectUnknownCopies(target: PackageBuildTarget): Promise<void> {
  const known = knownModelPaths(target);
  const unknown = (await modelFiles(target.tauriRoot)).filter((path) => !known.has(path));
  if (unknown.length > 0) {
    throw new Error(`Unexpected packaged model copies:\n${unknown.join("\n")}`);
  }
}

function otherPackageRoot(target: PackageBuildTarget): string | undefined {
  if (target.platform !== "darwin") return undefined;
  return macPackageRoot(target.tauriRoot, target.profile === "debug" ? "release" : "debug");
}

export async function preparePackageBuild(target: PackageBuildTarget): Promise<boolean> {
  const backup = backupRoot(target);
  if (await exists(backup)) {
    if (await exists(target.packageRoot)) {
      throw new Error(`Previous package backup requires recovery: ${backup}`);
    }
    return true;
  }
  if (!(await exists(target.packageRoot))) return false;
  await rename(target.packageRoot, backup);
  return true;
}

export async function rollbackPackageBuild(
  target: PackageBuildTarget,
  backupCreated: boolean,
): Promise<void> {
  await rm(target.packageRoot, { force: true, recursive: true });
  if (backupCreated) await rename(backupRoot(target), target.packageRoot);
}

export async function cleanModelCopies(target: PackageBuildTarget): Promise<void> {
  await verifyPackage(target);
  await rejectUnknownCopies(target);
  await rm(join(target.tauriRoot, "resources", "core", "models", generationModelFileName), {
    force: true,
  });
  await Promise.all(
    (["debug", "release"] as const).map((profile) =>
      rm(join(target.tauriRoot, "target", profile, "resources"), {
        force: true,
        recursive: true,
      }),
    ),
  );
  const otherPackage = otherPackageRoot(target);
  if (otherPackage !== undefined) await rm(otherPackage, { force: true, recursive: true });
  const remaining = await modelFiles(target.tauriRoot);
  const expected = packagedGenerationModelPath(
    packageResourcesRoot(target.packageRoot, target.platform),
  );
  const backup = backupRoot(target);
  const expectedBeforeBackupRemoval = [expected];
  if (await exists(backup)) {
    expectedBeforeBackupRemoval.push(
      packagedGenerationModelPath(packageResourcesRoot(backup, target.platform)),
    );
  }
  if (
    remaining.length !== expectedBeforeBackupRemoval.length ||
    remaining.some((path) => !expectedBeforeBackupRemoval.includes(path))
  ) {
    throw new Error(`Unexpected model copies remain after package cleanup.`);
  }
  await rm(backup, { force: true, recursive: true });
}

export async function cleanupDevelopmentModelOutput(desktopRoot: string): Promise<void> {
  await rm(
    join(
      desktopRoot,
      "src-tauri",
      "target",
      "debug",
      "resources",
      "core",
      "models",
      generationModelFileName,
    ),
    { force: true },
  );
}
