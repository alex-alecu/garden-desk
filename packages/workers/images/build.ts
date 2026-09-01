import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateGuestCapabilities } from "./capabilities.js";

type GuestArchitecture = "aarch64" | "x86_64";
interface Output {
  kernelFile: string;
  kernelSha256: string;
  initramfsFile: string;
  initramfsSha256: string;
}
interface Manifest {
  builder: {
    containerImage: string;
    sourceInputs: Array<{ file: string; sha256: string }>;
    sourceSha256: string;
    sourceDateEpoch: number;
    version: string;
    config?: string;
  };
  outputs: Record<GuestArchitecture, Output>;
}

const imageRoot = join(process.cwd(), "packages/workers/images");
const agentBuild = process.argv.includes("--agent");
const sharedGeneratedRoot = join(imageRoot, ".generated");
const generatedRoot = agentBuild ? join(sharedGeneratedRoot, "agent") : sharedGeneratedRoot;
const downloadRoot = join(sharedGeneratedRoot, "downloads");
const externalRoot = join(imageRoot, "buildroot-external");
const manifest = JSON.parse(
  await readFile(join(imageRoot, agentBuild ? "agent/manifest.json" : "manifest.json"), "utf8"),
) as Manifest;

function architecture(): GuestArchitecture {
  const index = process.argv.indexOf("--arch");
  const selected =
    index < 0 ? (process.arch === "arm64" ? "aarch64" : "x86_64") : process.argv[index + 1];
  if (selected !== "aarch64" && selected !== "x86_64")
    throw new Error("--arch must be aarch64 or x86_64.");
  return selected;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function docker(volume: string, networkDisabled: boolean, mounts: string[]): string[] {
  const args = [
    "run",
    "--rm",
    "--user",
    "0:0",
    "--env",
    `SOURCE_DATE_EPOCH=${manifest.builder.sourceDateEpoch}`,
    "--mount",
    `type=volume,src=${volume},dst=/workspace`,
    "--mount",
    `type=bind,src=${downloadRoot},dst=/downloads`,
    "--mount",
    `type=bind,src=${externalRoot},dst=/external,readonly`,
  ];
  for (const mount of mounts) args.push("--mount", mount);
  if (networkDisabled) args.push("--network", "none");
  args.push(manifest.builder.containerImage);
  return args;
}

function build(
  volume: string,
  archive: string,
  selected: GuestArchitecture,
  offline: boolean,
): void {
  const base = docker(volume, offline, [
    `type=bind,src=${archive},dst=/input/buildroot.tar.xz,readonly`,
  ]);
  run("docker", [...base, "tar", "-xJf", "/input/buildroot.tar.xz", "-C", "/workspace"]);
  const source = `/workspace/buildroot-${manifest.builder.version}`;
  const variables = ["BR2_EXTERNAL=/external", "O=/workspace/output", "BR2_DL_DIR=/downloads"];
  const config =
    agentBuild && selected === "x86_64"
      ? "garden_desk_agent_x86_64_defconfig"
      : (manifest.builder.config ?? `garden_desk_probe_${selected}_defconfig`);
  run("docker", [...base, "make", "-C", source, ...variables, config]);
  run("docker", [...base, "make", "-s", "-C", source, ...variables]);
}

function extract(volume: string, destination: string, output: Output): void {
  const base = docker(volume, true, [`type=bind,src=${destination},dst=/artifacts`]);
  run("docker", [
    ...base,
    "cp",
    `/workspace/output/images/${output.kernelFile}`,
    `/workspace/output/images/${output.initramfsFile}`,
    "/artifacts/",
  ]);
}

async function verifyInputs(): Promise<void> {
  for (const input of manifest.builder.sourceInputs) {
    if ((await sha256(join(downloadRoot, input.file))) !== input.sha256) {
      throw new Error(`Downloaded build input SHA-256 mismatch: ${input.file}`);
    }
  }
}

async function verifyBuilds(
  selected: GuestArchitecture,
  roots: [string, string],
): Promise<{ kernel: string; initramfs: string }> {
  const output = manifest.outputs[selected];
  const hashes = await Promise.all(
    roots.map(async (root) => ({
      kernel: await sha256(join(root, output.kernelFile)),
      initramfs: await sha256(join(root, output.initramfsFile)),
    })),
  );
  if (hashes[0]?.kernel !== hashes[1]?.kernel || hashes[0]?.initramfs !== hashes[1]?.initramfs) {
    throw new Error("Independent guest builds were not byte-for-byte reproducible.");
  }
  const actual = hashes[0];
  if (actual === undefined) throw new Error("Missing guest output hashes.");
  if (
    output.kernelSha256 !== "pending" &&
    (actual.kernel !== output.kernelSha256 || actual.initramfs !== output.initramfsSha256)
  ) {
    throw new Error(
      `Reproducible guest output does not match the immutable manifest: kernel=${hashes[0]?.kernel} initramfs=${hashes[0]?.initramfs}`,
    );
  }
  return actual;
}

async function install(selected: GuestArchitecture, source: string): Promise<void> {
  const output = manifest.outputs[selected];
  const destination = join(generatedRoot, "artifacts", selected);
  await mkdir(destination, { recursive: true });
  await copyFile(join(source, output.kernelFile), join(destination, output.kernelFile));
  await copyFile(join(source, output.initramfsFile), join(destination, output.initramfsFile));
  if (agentBuild) {
    await generateGuestCapabilities(
      join(destination, output.initramfsFile),
      join(imageRoot, "agent/manifest.json"),
      join(imageRoot, "agent/capabilities.json"),
    );
  }
}

const archiveValue = process.env.GARDEN_DESK_BUILDROOT_ARCHIVE;
if (archiveValue === undefined)
  throw new Error("Set GARDEN_DESK_BUILDROOT_ARCHIVE to the pinned Buildroot archive.");
const archive = resolve(archiveValue);
if ((await sha256(archive)) !== manifest.builder.sourceSha256)
  throw new Error("Buildroot source SHA-256 mismatch.");
const selected = architecture();
const volumes: [string, string] = [
  `garden-desk-${agentBuild ? "m3-agent" : "m1"}-${selected}-${process.pid}-first`,
  `garden-desk-${agentBuild ? "m3-agent" : "m1"}-${selected}-${process.pid}-second`,
];
const comparisonRoot = join(generatedRoot, "comparisons", String(process.pid));
const roots: [string, string] = [join(comparisonRoot, "first"), join(comparisonRoot, "second")];
await Promise.all([
  mkdir(downloadRoot, { recursive: true }),
  ...roots.map((root) => mkdir(root, { recursive: true })),
]);
try {
  for (const volume of volumes) run("docker", ["volume", "create", volume]);
  build(volumes[0], archive, selected, false);
  await verifyInputs();
  build(volumes[1], archive, selected, true);
  extract(volumes[0], roots[0], manifest.outputs[selected]);
  extract(volumes[1], roots[1], manifest.outputs[selected]);
  const hashes = await verifyBuilds(selected, roots);
  await install(selected, roots[0]);
  await rm(comparisonRoot, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      architecture: selected,
      kernelFile: manifest.outputs[selected].kernelFile,
      kernelSha256: hashes.kernel,
      initramfsFile: manifest.outputs[selected].initramfsFile,
      initramfsSha256: hashes.initramfs,
    }),
  );
} finally {
  for (const volume of volumes) run("docker", ["volume", "rm", "--force", volume]);
}
