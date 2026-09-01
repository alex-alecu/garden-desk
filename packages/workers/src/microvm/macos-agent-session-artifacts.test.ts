import { createHash, randomUUID } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: this boundary test reopens the real workspace store.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentExecutionIdSchema, AgentGuestResultSchema } from "@gardendesk/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgentHelperTransport } from "./agent-transport.js";
import { FramedAgentSession } from "./macos-agent-session.js";
import {
  type executeRequest,
  requireCodeRequest,
  resultFrame,
} from "./macos-agent-session-test-support.js";
import { AgentWorkspaceStore } from "./workspace-store.js";

const limits = {
  wallTimeMs: 1_000,
  memoryBytes: 256 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 1_000_000,
};

function artifactInvalidationFrame(requestId: string, executionId: string) {
  const captured = Buffer.from("current").toString("base64");
  const frame = resultFrame(requestId, executionId);
  return AgentGuestResultSchema.parse({
    ...frame,
    execution: {
      ...frame.execution,
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
      return { ...frame, execution: { ...frame.execution, path: code.path, source: code.source } };
    }),
    write: vi.fn(),
  } as unknown as AgentHelperTransport;
  const store = { applyDelta: vi.fn(async () => undefined) } as unknown as AgentWorkspaceStore;
  return new FramedAgentSession({
    sessionId: randomUUID(),
    limits,
    transport,
    store,
    temporaryRoot: "/tmp/unused-artifact-invalidation-test",
    lifecyclePlatform: "macos",
  });
}

function pathOnlySession(bytes: Buffer | undefined) {
  const frames: unknown[] = [];
  const transport = {
    exchange: vi.fn(async (request: ReturnType<typeof executeRequest>) => {
      const code = requireCodeRequest(request);
      frames.push(request);
      const frame = resultFrame(String(code.requestId), code.executionId);
      return AgentGuestResultSchema.parse({
        ...frame,
        execution: { ...frame.execution, path: code.path, source: code.source },
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
    store,
    session: new FramedAgentSession({
      sessionId: randomUUID(),
      limits,
      transport,
      store,
      temporaryRoot: "/tmp/unused-path-only-test",
      lifecyclePlatform: "macos",
    }),
  };
}

function failedWorkspaceSession(
  store: AgentWorkspaceStore,
  sessionId: string,
  executionId: string,
  bytes: Buffer,
) {
  return new FramedAgentSession({
    sessionId,
    limits,
    transport: {
      exchange: vi.fn(async (request: ReturnType<typeof executeRequest>) => {
        const code = requireCodeRequest(request);
        const frame = resultFrame(randomUUID(), executionId);
        return {
          ...frame,
          execution: {
            ...frame.execution,
            path: code.path,
            source: code.source,
            exitCode: 1,
            artifacts: [
              {
                name: "report.txt",
                mediaType: "text/plain",
                bytesBase64: bytes.toString("base64"),
              },
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
        };
      }),
      write: vi.fn(),
    } as unknown as AgentHelperTransport,
    store,
    temporaryRoot: "/tmp/unused-failed-workspace-test",
    lifecyclePlatform: "macos",
  });
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

  it("keeps a committed UTF-8 byte-order mark in the guest frame", async () => {
    const source = "\uFEFFprint('committed bytes')\n";
    const { frames, session } = pathOnlySession(Buffer.from(source));

    const result = await session.execute({ language: "python", path: "steps/saved.py" });

    expect(frames[0]).toMatchObject({ source });
    expect(result).toMatchObject({ source });
    expect(Buffer.from(result.source ?? "")).toEqual(Buffer.from(source));
  });
});

describe("invalid committed saved-script execution", () => {
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

  it("does not send an execution after cancellation during file resolution", async () => {
    let release!: (bytes: Buffer) => void;
    const delayed = new Promise<Buffer>((accept) => {
      release = accept;
    });
    const { frames, session, store } = pathOnlySession(undefined);
    vi.mocked(store.readFile).mockReturnValueOnce(delayed);
    const controller = new AbortController();

    const result = session.execute(
      { language: "python", path: "steps/saved.py" },
      controller.signal,
    );
    controller.abort(new DOMException("stop", "AbortError"));
    release(Buffer.from("print('must not run')"));

    await expect(result).rejects.toBeInstanceOf(DOMException);
    expect(frames).toEqual([]);
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
    expect(result.recoverableArtifactPaths).toEqual(["oversized.pdf", "steps/ignored.py"]);
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
    expect(result.recoverableArtifactPaths).toEqual([
      "captured.pdf",
      "oversized.pdf",
      "steps/ignored.py",
    ]);
  });
});

describe("failed execution persistence", () => {
  it("commits terminal workspace bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-failed-workspace-"));
    try {
      const executionId = AgentExecutionIdSchema.parse(randomUUID());
      const bytes = Buffer.from("durable failed output");
      const store = await AgentWorkspaceStore.create(root);
      const sessionId = randomUUID();
      const session = failedWorkspaceSession(store, sessionId, executionId, bytes);

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
