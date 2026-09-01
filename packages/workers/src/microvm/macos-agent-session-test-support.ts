// biome-ignore lint/style/noRestrictedImports: the fake child verifies the bounded helper transport without spawning.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AgentGuestExecuteRequestSchema, AgentGuestResultSchema } from "@gardendesk/shared";

export function fakeChild(): {
  child: ChildProcessWithoutNullStreams;
  stderr: PassThrough;
  stdout: PassThrough;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  });
  return { child: child as unknown as ChildProcessWithoutNullStreams, stderr, stdout };
}

export function executeRequest(requestId: string, executionId: string) {
  return AgentGuestExecuteRequestSchema.parse({
    protocolVersion: 3 as const,
    requestId,
    executionId,
    operation: "execute" as const,
    language: "python" as const,
    path: "steps/live.py",
    source: "print('live')",
    limits: {
      wallTimeMs: 1_000,
      memoryBytes: 256 * 1024 * 1024,
      scratchBytes: 128 * 1024 * 1024,
      outputBytes: 1_000_000,
    },
  });
}

export function resultFrame(requestId: string, executionId: string) {
  return AgentGuestResultSchema.parse({
    protocolVersion: 3 as const,
    requestId,
    executionId,
    status: "ok" as const,
    operation: "execute" as const,
    nonLoopbackNetworkDeviceCount: 0,
    scratchBytes: 128 * 1024 * 1024,
    transport: "vsock" as const,
    execution: {
      language: "python" as const,
      path: "steps/live.py",
      source: "print('live')",
      command: null,
      exitCode: 0,
      stdout: "live\n",
      stderr: "",
      durationMs: 1,
      termination: "completed" as const,
      artifacts: [],
    },
    workspaceDelta: { entries: [], removedPaths: [] },
  });
}

export function requireCodeRequest(request: ReturnType<typeof executeRequest>) {
  if (request.language === "shell") throw new Error("unexpected_shell_request");
  return request;
}
