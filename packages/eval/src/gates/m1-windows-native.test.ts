import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsMicroVmLauncher } from "@gardendesk/workers";
import { describe, expect, it } from "vitest";

const describeWindows =
  process.platform === "win32" && process.arch === "x64" ? describe : describe.skip;

function helperPath(): string {
  return join(
    process.cwd(),
    "packages/workers/native/windows-hcs-helper/.generated/garden-desk-hcs-helper.exe",
  );
}

function limits(scratchBytes: number) {
  return {
    wallTimeMs: 60_000,
    inputCount: 1,
    inputBytes: 16 * 1024 * 1024,
    memoryBytes: 256 * 1024 * 1024,
    scratchBytes,
    outputBytes: 4096,
    cpuCount: 1,
  };
}

function configuration(
  helper: string,
  input: string,
  scratch: string,
  source?: string,
): Record<string, unknown> {
  const artifacts = join(process.cwd(), "packages/workers/images/.generated/artifacts/x86_64");
  const result = spawnSync(
    helper,
    [
      "--print-configuration",
      "--kernel",
      join(artifacts, "bzImage"),
      "--initramfs",
      join(artifacts, "rootfs.cpio"),
      "--cpus",
      "1",
      "--memory",
      String(256 * 1024 * 1024),
      "--scratch",
      scratch,
      "--scratch-bytes",
      String(8 * 1024 * 1024),
      "--input",
      input,
      ...(source === undefined ? [] : ["--source", source]),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || "HCS configuration inspection failed.");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describeWindows("M1 certified Windows microVM", () => {
  it("boots the immutable no-NIC guest with typed IPC and bounded attachments", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-m1-windows-"));
    try {
      const input = join(root, "input.txt");
      await writeFile(input, "read-only input");
      const result = await new WindowsMicroVmLauncher(helperPath()).launchProbe({
        jobId: randomUUID(),
        readonlyInputs: [input],
        limits: limits(8 * 1024 * 1024),
      });
      expect(result.classification).toBe("certified");
      expect(result.networkDeviceCount).toBe(0);
      expect(result.socketDeviceCount).toBe(1);
      expect(result.readOnlyInputCount).toBe(1);
      expect(result.scratchBytes).toBe(8 * 1024 * 1024);
      expect(result.guest.nonLoopbackNetworkDeviceCount).toBe(0);
      expect(Object.values(result.guest.probes).every(Boolean)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("configures only typed Hyper-V socket and bounded SCSI attachments", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-m1-windows-config-"));
    try {
      const input = join(root, "input.vhd");
      const scratch = join(root, "scratch.vhd");
      const source = join(root, "source");
      await Promise.all([writeFile(input, "input"), writeFile(scratch, "scratch"), mkdir(source)]);
      const document = configuration(helperPath(), input, scratch, source) as {
        VirtualMachine: { Devices: Record<string, unknown> };
      };
      expect(document.VirtualMachine.Devices).not.toHaveProperty("NetworkAdapters");
      expect(document.VirtualMachine.Devices).toHaveProperty("HvSocket");
      expect(document.VirtualMachine.Devices).toMatchObject({
        Plan9: {
          Shares: [{ AccessName: "source", Flags: 5, Name: "source", Port: 564 }],
        },
      });
      expect(document.VirtualMachine.Devices.Plan9).not.toHaveProperty("ReadOnly");
      expect(JSON.stringify(document)).toContain('"ReadOnly":true');
      expect(JSON.stringify(document)).toContain('"ReadOnly":false');
      expect(JSON.stringify(document)).toContain("S-1-5-32-578");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
