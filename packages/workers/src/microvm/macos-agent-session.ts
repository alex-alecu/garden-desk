import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  type AgentExecutionResult,
  AgentGuestExecuteRequestSchema,
  AgentGuestHelloRequestSchema,
  AgentGuestHelloResultSchema,
  AgentGuestHydrateRequestSchema,
  AgentGuestHydrateResultSchema,
  type AgentGuestInput,
  AgentGuestResultSchema,
  type AgentWorkspaceDelta,
} from "@vault/shared";
import type { AgentHelperTransport } from "./agent-transport.js";
import type {
  AgentExecutionObserver,
  AgentSessionExecution,
  CodeAgentSession,
  ResolvedAgentSessionExecution,
} from "./launcher.js";
import type { AgentWorkspaceStore } from "./workspace-store.js";

interface GuestInitialization {
  sessionId: string;
  inputs: AgentGuestInput[];
  limits: {
    wallTimeMs: number;
    memoryBytes: number;
    scratchBytes: number;
    outputBytes: number;
  };
  transport: AgentHelperTransport;
  store: AgentWorkspaceStore;
  signal: AbortSignal;
}

function invalidatedArtifactPaths(
  execution: Pick<AgentExecutionResult, "artifacts" | "exitCode" | "termination">,
  delta: AgentWorkspaceDelta,
): string[] {
  const captured =
    execution.termination === "completed" && execution.exitCode === 0
      ? new Set(execution.artifacts.map((artifact) => artifact.name))
      : new Set<string>();
  const paths = new Set(delta.removedPaths);
  for (const entry of delta.entries) {
    if (entry.kind !== "file" || !captured.has(entry.path)) paths.add(entry.path);
  }
  return [...paths].filter((path) => !path.startsWith("steps/"));
}

function userArtifactPath(path: string): boolean {
  const name = path.split("/").at(-1)?.toLocaleLowerCase("en-US");
  return !(
    path.startsWith("steps/") ||
    path === ".vault-tools" ||
    path.startsWith(".vault-tools/") ||
    path === ".vault-output" ||
    path.startsWith(".vault-output/") ||
    name === "checkpoint.json" ||
    name === "checkpoints.json"
  );
}

function recoverableArtifactPaths(
  execution: Pick<AgentExecutionResult, "artifacts" | "exitCode" | "termination">,
  delta: AgentWorkspaceDelta,
): string[] {
  const captured =
    execution.termination === "completed" && execution.exitCode === 0
      ? new Set(execution.artifacts.map((artifact) => artifact.name))
      : new Set<string>();
  return delta.entries
    .filter(
      (entry) => entry.kind === "file" && !captured.has(entry.path) && userArtifactPath(entry.path),
    )
    .map((entry) => entry.path);
}

async function resolveExecution(
  request: AgentSessionExecution,
  store: AgentWorkspaceStore,
  sessionId: string,
): Promise<ResolvedAgentSessionExecution> {
  if (request.language === "shell") return request;
  if (request.source !== undefined) {
    return { language: request.language, path: request.path, source: request.source };
  }
  const bytes = await store.readFile(sessionId, request.path);
  if (bytes === undefined) throw new Error("agent_script_missing");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("agent_script_invalid_text");
  }
  if (source.length === 0) throw new Error("agent_script_invalid_text");
  if (source.length > 128_000) throw new Error("agent_script_source_oversized");
  return { language: request.language, path: request.path, source };
}

function requireExecutionIdentity(
  result: AgentExecutionResult,
  request: ResolvedAgentSessionExecution,
): void {
  if (result.language !== request.language) throw new Error("agent_helper_execution_mismatch");
  if (request.language === "shell") {
    if (result.command !== request.command) throw new Error("agent_helper_execution_mismatch");
    return;
  }
  if (result.path !== request.path || result.source !== request.source) {
    throw new Error("agent_helper_execution_mismatch");
  }
}

export async function initializeAgentGuest(options: GuestInitialization): Promise<void> {
  const hello = AgentGuestHelloResultSchema.parse(
    await options.transport.exchange(
      AgentGuestHelloRequestSchema.parse({
        protocolVersion: 3,
        requestId: randomUUID(),
        jobId: options.sessionId,
        operation: "hello",
        inputs: options.inputs,
        limits: options.limits,
      }),
      options.signal,
    ),
  );
  if (hello.nonLoopbackNetworkDeviceCount !== 0) throw new Error("agent_guest_not_certified");
  AgentGuestHydrateResultSchema.parse(
    await options.transport.exchange(
      AgentGuestHydrateRequestSchema.parse({
        protocolVersion: 3,
        requestId: randomUUID(),
        operation: "hydrate",
        workspace: await options.store.load(options.sessionId),
      }),
      options.signal,
    ),
  );
}

export class FramedAgentSession implements CodeAgentSession {
  private activeRequestId: string | undefined;
  private closed = false;

  constructor(
    private readonly options: {
      sessionId: string;
      limits: {
        wallTimeMs: number;
        memoryBytes: number;
        scratchBytes: number;
        outputBytes: number;
      };
      transport: AgentHelperTransport;
      store: AgentWorkspaceStore;
      temporaryRoot: string;
      lifecycleObserver?: AgentExecutionObserver;
      lifecyclePlatform: "macos" | "windows";
    },
  ) {}

  async execute(
    request: AgentSessionExecution,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error("agent_session_closed");
    if (this.activeRequestId !== undefined) throw new Error("agent_session_busy");
    const requestId = randomUUID();
    const executionId = observer?.executionId ?? randomUUID();
    this.activeRequestId = requestId;
    const abort = () => {
      try {
        this.options.transport.write({ protocolVersion: 3, requestId, operation: "cancel" });
      } catch {
        // The pending exchange reports a helper failure.
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const resolved = await resolveExecution(request, this.options.store, this.options.sessionId);
      signal?.throwIfAborted();
      const frame = AgentGuestExecuteRequestSchema.parse({
        protocolVersion: 3,
        requestId,
        executionId,
        operation: "execute",
        ...resolved,
        limits: this.options.limits,
      });
      await observer?.onPrepared?.(resolved);
      signal?.throwIfAborted();
      const result = AgentGuestResultSchema.parse(
        await this.options.transport.exchange(frame, undefined, {
          executionId,
          onUpdate: observer?.onUpdate ?? (() => undefined),
        }),
      );
      if (result.executionId !== executionId) throw new Error("agent_helper_execution_mismatch");
      if (result.nonLoopbackNetworkDeviceCount !== 0) throw new Error("agent_guest_not_certified");
      requireExecutionIdentity(result.execution, resolved);
      await this.options.store.applyDelta(this.options.sessionId, result.workspaceDelta);
      return {
        ...result.execution,
        invalidatedArtifactPaths: invalidatedArtifactPaths(result.execution, result.workspaceDelta),
        recoverableArtifactPaths: recoverableArtifactPaths(result.execution, result.workspaceDelta),
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      this.activeRequestId = undefined;
    }
  }

  async cancel(): Promise<void> {
    if (this.activeRequestId !== undefined) {
      try {
        this.options.transport.write({
          protocolVersion: 3,
          requestId: this.activeRequestId,
          operation: "cancel",
        });
      } catch {
        // The active exchange reports a helper failure.
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.options.transport.close();
    } finally {
      try {
        await this.options.lifecycleObserver?.onUpdate({
          kind: "diagnostic",
          code: "teardown",
          platform: this.options.lifecyclePlatform,
        });
      } finally {
        await rm(this.options.temporaryRoot, { recursive: true, force: true });
      }
    }
  }
}
