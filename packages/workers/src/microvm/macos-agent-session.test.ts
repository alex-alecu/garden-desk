// biome-ignore lint/style/noRestrictedImports: the fake child verifies the bounded helper transport without spawning.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
// biome-ignore lint/style/noRestrictedImports: this boundary test reopens the real workspace store.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  AgentExecutionIdSchema,
  AgentGuestExecuteRequestSchema,
  AgentGuestResultSchema,
} from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import { encodeFrame } from "../ipc.js";
import { AgentHelperTransport } from "./agent-transport.js";
import { FramedAgentSession } from "./macos-agent-session.js";
import { AgentWorkspaceStore } from "./workspace-store.js";

function fakeChild(): {
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

function executeRequest(requestId: string, executionId: string) {
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

function resultFrame(requestId: string, executionId: string) {
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

function requireCodeRequest(request: ReturnType<typeof executeRequest>) {
  if (request.language === "shell") throw new Error("unexpected_shell_request");
  return request;
}

describe("agent helper ordered live stream", () => {
  it("delivers ordered bounded frames before the terminal result", async () => {
    const { child, stdout } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const updates: string[] = [];
    const result = transport.exchange(executeRequest(requestId, executionId), undefined, {
      executionId,
      onUpdate(update) {
        updates.push(
          update.kind === "stream" ? Buffer.from(update.bytes).toString("utf8") : update.code,
        );
      },
    });
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "diagnostic",
        sequence: 0,
        diagnostic: { code: "process_start", platform: "guest", platformCode: null },
      }),
    );
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 1,
        stream: "stdout",
        contentBase64: Buffer.from("live\n").toString("base64"),
        byteLength: 5,
      }),
    );
    stdout.write(encodeFrame(resultFrame(requestId, executionId)));

    await expect(result).resolves.toMatchObject({ operation: "execute", executionId });
    expect(updates).toEqual(["process_start", "live\n"]);
  });
});

function artifactInvalidationFrame(requestId: string, executionId: string) {
  const captured = Buffer.from("current").toString("base64");
  return AgentGuestResultSchema.parse({
    ...resultFrame(requestId, executionId),
    execution: {
      ...resultFrame(requestId, executionId).execution,
      artifacts: [{ name: "captured.pdf", mediaType: "application/pdf", bytesBase64: captured }],
    },
    workspaceDelta: {
      entries: [
        {
          kind: "file",
          path: "captured.pdf",
          contentHash: "a".repeat(64),
          bytesBase64: captured,
        },
        {
          kind: "file",
          path: "oversized.pdf",
          contentHash: "b".repeat(64),
          bytesBase64: "",
        },
        { kind: "directory", path: "reports" },
        {
          kind: "file",
          path: "steps/ignored.py",
          contentHash: "c".repeat(64),
          bytesBase64: "",
        },
      ],
      removedPaths: ["deleted.pdf"],
    },
  });
}

function artifactInvalidationSession(frame: ReturnType<typeof artifactInvalidationFrame>) {
  const transport = {
    exchange: vi.fn(async (request: ReturnType<typeof executeRequest>) => {
      const code = requireCodeRequest(request);
      return {
        ...frame,
        execution: { ...frame.execution, path: code.path, source: code.source },
      };
    }),
    write: vi.fn(),
  } as unknown as AgentHelperTransport;
  const store = { applyDelta: vi.fn(async () => undefined) } as unknown as AgentWorkspaceStore;
  return new FramedAgentSession({
    sessionId: randomUUID(),
    limits: {
      wallTimeMs: 1_000,
      memoryBytes: 256 * 1024 * 1024,
      scratchBytes: 128 * 1024 * 1024,
      outputBytes: 1_000_000,
    },
    transport,
    store,
    temporaryRoot: "/tmp/unused-artifact-invalidation-test",
    lifecyclePlatform: "macos",
  });
}

function failedWorkspaceFrame(executionId: string, bytes: Buffer) {
  const frame = resultFrame(randomUUID(), executionId);
  return AgentGuestResultSchema.parse({
    ...frame,
    execution: {
      ...frame.execution,
      exitCode: 1,
      artifacts: [
        { name: "report.txt", mediaType: "text/plain", bytesBase64: bytes.toString("base64") },
      ],
    },
    workspaceDelta: {
      entries: [
        {
          kind: "file",
          path: "report.txt",
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          bytesBase64: bytes.toString("base64"),
        },
      ],
      removedPaths: [],
    },
  });
}

function pathOnlySession(bytes: Buffer | undefined) {
  const frames: unknown[] = [];
  const transport = {
    exchange: vi.fn(async (request: ReturnType<typeof executeRequest>) => {
      const code = requireCodeRequest(request);
      frames.push(request);
      return AgentGuestResultSchema.parse({
        ...resultFrame(String(code.requestId), code.executionId),
        execution: {
          ...resultFrame(String(code.requestId), code.executionId).execution,
          path: code.path,
          source: code.source,
        },
      });
    }),
    write: vi.fn(),
  } as unknown as AgentHelperTransport;
  const store = {
    readFile: vi.fn(async () => bytes),
    applyDelta: vi.fn(async () => undefined),
  } as unknown as AgentWorkspaceStore;
  return {
    frames,
    session: new FramedAgentSession({
      sessionId: randomUUID(),
      limits: {
        wallTimeMs: 1_000,
        memoryBytes: 256 * 1024 * 1024,
        scratchBytes: 128 * 1024 * 1024,
        outputBytes: 1_000_000,
      },
      transport,
      store,
      temporaryRoot: "/tmp/unused-path-only-test",
      lifecyclePlatform: "macos",
    }),
  };
}

describe("committed saved-script execution", () => {
  it("sends exact committed UTF-8 bytes through the existing guest frame", async () => {
    const source = "print('committed bytes')\n";
    const { frames, session } = pathOnlySession(Buffer.from(source));

    const result = await session.execute({ language: "python", path: "steps/saved.py" });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      protocolVersion: 3,
      language: "python",
      path: "steps/saved.py",
      source,
    });
    expect(result).toMatchObject({ path: "steps/saved.py", source });
  });

  it.each([
    [undefined, "agent_script_missing"],
    [Buffer.from([0xff]), "agent_script_invalid_text"],
    [Buffer.alloc(128_001, 0x61), "agent_script_source_oversized"],
  ])("rejects an unusable committed file", async (bytes, error) => {
    const { session } = pathOnlySession(bytes);
    await expect(session.execute({ language: "python", path: "steps/saved.py" })).rejects.toThrow(
      error,
    );
  });
});

describe("agent artifact candidate invalidation", () => {
  it("invalidates changed files omitted by artifact limits without invalidating captured files", async () => {
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const session = artifactInvalidationSession(
      artifactInvalidationFrame(randomUUID(), executionId),
    );
    const result = await session.execute(
      { language: "python", path: "steps/live.py", source: "print('live')" },
      undefined,
      { executionId, onUpdate() {} },
    );
    expect(result.invalidatedArtifactPaths).toEqual(["deleted.pdf", "oversized.pdf", "reports"]);
  });

  it("invalidates every changed artifact path after a failed execution", async () => {
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const frame = artifactInvalidationFrame(randomUUID(), executionId);
    frame.execution.exitCode = 1;
    const session = artifactInvalidationSession(frame);

    const result = await session.execute(
      { language: "python", path: "steps/live.py", source: "raise SystemExit(1)" },
      undefined,
      { executionId, onUpdate() {} },
    );

    expect(result.invalidatedArtifactPaths).toEqual([
      "deleted.pdf",
      "captured.pdf",
      "oversized.pdf",
      "reports",
    ]);
  });
});

describe("failed execution persistence", () => {
  it("commits terminal workspace bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-failed-workspace-"));
    try {
      const executionId = AgentExecutionIdSchema.parse(randomUUID());
      const bytes = Buffer.from("durable failed output");
      const store = await AgentWorkspaceStore.create(root);
      const sessionId = randomUUID();
      const session = new FramedAgentSession({
        sessionId,
        limits: {
          wallTimeMs: 1_000,
          memoryBytes: 256 * 1024 * 1024,
          scratchBytes: 128 * 1024 * 1024,
          outputBytes: 1_000_000,
        },
        transport: {
          exchange: vi.fn(async (request: ReturnType<typeof executeRequest>) => {
            const code = requireCodeRequest(request);
            return {
              ...failedWorkspaceFrame(executionId, bytes),
              execution: {
                ...failedWorkspaceFrame(executionId, bytes).execution,
                path: code.path,
                source: code.source,
              },
            };
          }),
          write: vi.fn(),
        } as unknown as AgentHelperTransport,
        store,
        temporaryRoot: "/tmp/unused-failed-workspace-test",
        lifecyclePlatform: "macos",
      });

      await session.execute(
        { language: "python", path: "steps/live.py", source: "raise SystemExit(1)" },
        undefined,
        { executionId, onUpdate() {} },
      );

      const reopened = await AgentWorkspaceStore.create(root);
      await expect(reopened.load(sessionId)).resolves.toEqual([
        {
          kind: "file",
          path: "report.txt",
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          bytesBase64: bytes.toString("base64"),
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("agent helper stream validation", () => {
  it("rejects out-of-order and oversized stream frames", async () => {
    const { child, stdout } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const result = transport.exchange(executeRequest(requestId, executionId), undefined, {
      executionId,
      onUpdate() {},
    });
    stdout.write(
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 1,
        stream: "stdout",
        contentBase64: "YQ==",
        byteLength: 1,
      }),
    );
    await expect(result).rejects.toThrow("agent_helper_stream_order_invalid");
    expect(() =>
      encodeFrame({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "stream",
        sequence: 0,
        stream: "stdout",
        contentBase64: "YQ==",
        byteLength: 64 * 1024 + 1,
      }),
    ).toThrow();
  });
});

describe("agent helper error privacy", () => {
  it("does not surface raw helper stderr", async () => {
    const { child, stderr } = fakeChild();
    const transport = new AgentHelperTransport(child);
    const requestId = randomUUID();
    const executionId = AgentExecutionIdSchema.parse(randomUUID());
    const result = transport.exchange(executeRequest(requestId, executionId));
    stderr.write("/private/tmp/customer-path secret");
    child.emit("close", 1, null);

    await expect(result).rejects.toThrow("agent_helper_exited_1");
    await expect(result).rejects.not.toThrow("customer-path");
  });
});
