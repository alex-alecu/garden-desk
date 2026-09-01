import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacOsMicroVmLauncher } from "@gardendesk/workers";
import { describe, expect, it } from "vitest";

const describeMac =
  process.platform === "darwin" && process.arch === "arm64" ? describe : describe.skip;

function limits(scratchBytes: number) {
  return {
    wallTimeMs: 30_000,
    inputCount: 1,
    inputBytes: 16 * 1024 * 1024,
    memoryBytes: 256 * 1024 * 1024,
    scratchBytes,
    outputBytes: 4096,
    cpuCount: 1,
  };
}

const fakeNetworkedReport = {
  classification: "certified",
  networkDeviceCount: 1,
  socketDeviceCount: 1,
  readOnlyInputCount: 1,
  scratchBytes: 0,
  guest: {
    protocolVersion: 1,
    requestId: "m1-probe",
    status: "ok",
    nonLoopbackNetworkDeviceCount: 0,
    transport: "vsock",
    probes: {
      dnsBlocked: true,
      hostBlocked: true,
      ipv4Blocked: true,
      ipv6Blocked: true,
      lanBlocked: true,
      multicastBlocked: true,
    },
  },
};

describeMac("M1 certified macOS microVM", () => {
  it("boots the immutable no-NIC guest with typed IPC and bounded attachments", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "garden-desk-m1-native-"));
    try {
      const input = join(temporaryRoot, "input.img");
      await writeFile(input, "read-only input");
      const helper = join(
        process.cwd(),
        "packages/workers/native/macos-vz-helper/.generated/garden-desk-vz-helper",
      );
      const result = await new MacOsMicroVmLauncher(helper).launchProbe({
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
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

describeMac("M1 microVM certification classification", () => {
  it("cannot report a process-only or network-configured result as certified", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-m1-fake-helper-"));
    try {
      const helper = join(root, "fake-helper");
      const input = join(root, "input.img");
      await writeFile(
        helper,
        `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(fakeNetworkedReport))});\n`,
      );
      await chmod(helper, 0o700);
      await writeFile(input, "input");
      const result = await new MacOsMicroVmLauncher(helper).launchProbe({
        jobId: randomUUID(),
        readonlyInputs: [input],
        limits: limits(0),
      });
      expect(result.classification).toBe("compatible_unverified");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
