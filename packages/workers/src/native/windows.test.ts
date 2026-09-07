// biome-ignore lint/style/noRestrictedImports: This test mocks the native launcher process.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { protectSocketDirectory } from "./private-socket.js";
import {
  WindowsNativeWorkerLauncher,
  windowsHelperEnvironment,
  windowsNativeWorkerArguments,
} from "./windows.js";
import { resolveWindowsGpuMemoryProfile } from "./windows-gpu-policy.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("scratch"),
  rm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./private-socket.js", () => ({
  protectSocketDirectory: vi.fn().mockResolvedValue(undefined),
  connectWindowsSocket: vi.fn(),
}));

it.skipIf(process.platform !== "win32" || process.arch !== "x64")(
  "protects socket directories for servers only, not GPU inventory probes",
  async () => {
    vi.mocked(spawn).mockImplementation((_file, args) => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null,
        signalCode: null,
        kill: () => child.emit("close", 0),
      });
      if (args?.[0] === "prepare") queueMicrotask(() => child.emit("close", 0));
      return child as unknown as ReturnType<typeof spawn>;
    });
    const launcher = new WindowsNativeWorkerLauncher("helper.exe", "llama-server.exe");
    for (const serverArguments of [["--list-devices", "--offline"], []]) {
      const handle = await launcher.launch({
        workerEntryPath: "unused",
        memoryBudgetBytes: 1024,
        serverArguments,
      });
      try {
        const bindsSocket = serverArguments.length === 0;
        expect(protectSocketDirectory).toHaveBeenCalledTimes(bindsSocket ? 1 : 0);
        expect(typeof handle.connect).toBe(bindsSocket ? "function" : "undefined");
      } finally {
        await handle.dispose();
      }
    }
  },
);

it("reserves host memory beyond the GPU budget for the Windows inference process", () => {
  const gpuBudget = 16 * 1024 ** 3;
  const hostLimit = 20 * 1024 ** 3;
  const arguments_ = windowsNativeWorkerArguments(
    { workerEntryPath: "unused", memoryBudgetBytes: gpuBudget, serverArguments: [] },
    "scratch",
    "/packaged/llama-server.exe",
    { gpu: { backend: "cuda", memoryKind: "dedicated" } },
  );
  expect(
    arguments_.slice(arguments_.indexOf("--memory"), arguments_.indexOf("--memory") + 2),
  ).toEqual(["--memory", String(hostLimit)]);
  expect(resolveWindowsGpuMemoryProfile(false, gpuBudget, 32 * 1024 ** 3)).toEqual({
    memoryBudgetBytes: gpuBudget,
    hostMemoryReservationBytes: hostLimit,
  });
});

describe("Windows native worker launch arguments", () => {
  it("uses the dedicated packaged Node runtime", () => {
    const arguments_ = windowsNativeWorkerArguments(
      {
        workerEntryPath: "worker.mjs",
        memoryBudgetBytes: 12,
      },
      "scratch",
      "/packaged/node",
    );

    expect(arguments_.slice(0, 4)).toEqual(["run", "--executable", "/packaged/node", "--worker"]);
    expect(arguments_).not.toContain("--gpu-backend");
  });

  it("adds one validated GPU selection and memory profile", () => {
    const arguments_ = windowsNativeWorkerArguments(
      { workerEntryPath: "worker.mjs", memoryBudgetBytes: 12 },
      "scratch",
      "/packaged/node",
      {
        gpu: {
          backend: "vulkan",
          deviceIndex: 2,
          expectedName: "Integrated Graphics",
          memoryKind: "unified",
          detectedMemoryBytes: 16,
          installedMemoryBytes: 32,
        },
      },
    );

    expect(arguments_).toEqual(
      expect.arrayContaining([
        "--gpu-backend",
        "vulkan",
        "--gpu-device-index",
        "2",
        "--expected-gpu-name",
        "Integrated Graphics",
        "--gpu-memory-kind",
        "unified",
      ]),
    );
  });

  it.each([-1, 1.5, 0x1_0000_0000])("rejects the numeric GPU selector %s", (deviceIndex) => {
    expect(() =>
      windowsNativeWorkerArguments(
        { workerEntryPath: "worker.mjs", memoryBudgetBytes: 12 },
        "scratch",
        "/packaged/node",
        { gpu: { backend: "vulkan", deviceIndex } },
      ),
    ).toThrow("invalid_windows_gpu_selection");
  });
});

describe("Windows helper environment", () => {
  it("does not pass credentials or network configuration to the helper", () => {
    expect(windowsHelperEnvironment()).toEqual({
      PATH: expect.any(String),
      SystemRoot: expect.any(String),
      WINDIR: expect.any(String),
    });
  });
});
