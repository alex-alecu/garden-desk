import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacOsMicroVmLauncher, WindowsMicroVmLauncher } from "@gardendesk/workers";

async function macReport(): Promise<unknown> {
  const helper = join(
    process.cwd(),
    "packages/workers/native/macos-vz-helper/.generated/garden-desk-vz-helper",
  );
  const artifacts = join(process.cwd(), "packages/workers/images/.generated/artifacts/aarch64");
  if (!existsSync(helper) || !existsSync(artifacts)) {
    return {
      classification: "compatible_unverified",
      reason: "Build the signed helper and pinned arm64 guest before certification.",
    };
  }
  const root = await mkdtemp(join(tmpdir(), "garden-desk-m1-platform-"));
  try {
    const input = join(root, "input.img");
    await writeFile(input, "probe input");
    return await new MacOsMicroVmLauncher(helper).launchProbe({
      jobId: randomUUID(),
      readonlyInputs: [input],
      limits: {
        wallTimeMs: 30_000,
        inputCount: 1,
        inputBytes: 16 * 1024 * 1024,
        memoryBytes: 256 * 1024 * 1024,
        scratchBytes: 8 * 1024 * 1024,
        outputBytes: 4096,
        cpuCount: 1,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function windowsReport(): Promise<unknown> {
  const helper = join(
    process.cwd(),
    "packages/workers/native/windows-hcs-helper/.generated/garden-desk-hcs-helper.exe",
  );
  const artifacts = join(process.cwd(), "packages/workers/images/.generated/artifacts/x86_64");
  if (!existsSync(helper) || !existsSync(artifacts)) {
    return {
      classification: "compatible_unverified",
      reason: "Build the signed HCS helper and pinned x86_64 guest before certification.",
    };
  }
  const root = await mkdtemp(join(tmpdir(), "garden-desk-m1-platform-"));
  try {
    const input = join(root, "input.txt");
    await writeFile(input, "probe input");
    try {
      return await new WindowsMicroVmLauncher(helper).launchProbe({
        jobId: randomUUID(),
        readonlyInputs: [input],
        limits: {
          wallTimeMs: 60_000,
          inputCount: 1,
          inputBytes: 16 * 1024 * 1024,
          memoryBytes: 256 * 1024 * 1024,
          scratchBytes: 8 * 1024 * 1024,
          outputBytes: 4096,
          cpuCount: 1,
        },
      });
    } catch (error) {
      return {
        classification: "compatible_unverified",
        reason: error instanceof Error ? error.message : "Windows HCS probe failed.",
      };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function stageReport(): Promise<unknown> {
  if (process.platform === "darwin" && process.arch === "arm64") return await macReport();
  if (process.platform === "win32" && process.arch === "x64") return await windowsReport();
  return {
    classification: "unsupported",
    reason: "M1 certification supports macOS Apple silicon and Windows x64 with Hyper-V.",
  };
}

const report = await stageReport();
console.log(JSON.stringify(report));
if (process.argv.includes("--require-certified")) {
  const classification = (report as { classification?: string }).classification;
  if (classification !== "certified") process.exitCode = 1;
}
