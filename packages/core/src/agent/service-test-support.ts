// biome-ignore lint/style/noRestrictedImports: agent-service fixtures need isolated workspace roots.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult, ChatGenerationResult } from "@vault/shared";
import type { AgentSessionExecution, CodeAgentLauncher } from "@vault/workers";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import type { ChatInput, InferenceService } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { memoryReport } from "./chat-loop-test-support.js";
import { AgentService } from "./service.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

export function chatResult(
  text: string,
  toolCalls: ChatGenerationResult["toolCalls"],
): ChatGenerationResult {
  return {
    protocolVersion: 2,
    requestId: "agent-test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "toolCalls" : "text",
    memory: memoryReport({ budgetBytes: 2, contextSizeTokens: 16_384 }),
    performance: {
      promptTokens: 10,
      outputTokens: 5,
      promptDurationMs: 100,
      generationDurationMs: 500,
      totalDurationMs: 600,
    },
  };
}

function launcher(
  run: (request: AgentSessionExecution) => Promise<AgentExecutionResult>,
  afterPrepared?: () => Promise<void>,
  readWorkspaceFile?: (sessionId: string, path: string) => Promise<Buffer | undefined>,
): CodeAgentLauncher {
  return {
    async openAgentSession() {
      return {
        async execute(request, _signal, observer) {
          const result = await run(request);
          await observer?.onPrepared?.(
            result.language === "shell"
              ? { language: "shell", command: result.command }
              : { language: result.language, path: result.path, source: result.source },
          );
          await afterPrepared?.();
          if (result.stdout.length > 0)
            await observer?.onUpdate({
              kind: "stream",
              stream: "stdout",
              bytes: Buffer.from(result.stdout),
            });
          if (result.stderr.length > 0)
            await observer?.onUpdate({
              kind: "stream",
              stream: "stderr",
              bytes: Buffer.from(result.stderr),
            });
          return result;
        },
        async cancel() {},
        async close() {},
      };
    },
    async deleteWorkspace() {},
    ...(readWorkspaceFile === undefined ? {} : { readWorkspaceFile }),
  };
}

export async function fixture(
  inference: Partial<Pick<InferenceService, "chat" | "modelStatus">>,
  execute: (request: AgentSessionExecution) => Promise<AgentExecutionResult>,
  afterPrepared?: () => Promise<void>,
  readWorkspaceFile?: (sessionId: string, path: string) => Promise<Buffer | undefined>,
) {
  const root = await mkdtemp(join(tmpdir(), "vault-agent-service-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const store = new AgentStore(catalog.database, artifacts);
  const service = new AgentService(
    catalog.database,
    store,
    conversations,
    new JobStore(catalog.database),
    artifacts,
    inference,
    launcher(execute, afterPrepared, readWorkspaceFile),
    new AuditLog(catalog.database),
  );
  return { catalog, conversations, service };
}

export async function terminal(service: AgentService, runId: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const snapshot = service.snapshot(runId);
    if (!(["queued", "running"] as const).includes(snapshot.run.state as "queued" | "running"))
      return snapshot;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

export async function pendingQuestion(service: AgentService, runId: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const snapshot = service.snapshot(runId);
    if (snapshot.question !== null) return snapshot.question;
    if (snapshot.run.state !== "running" && snapshot.run.state !== "queued") {
      throw new Error("agent_finished_without_question");
    }
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_question_timeout");
}

const questionCall = {
  id: "call-q",
  name: "question",
  params: {
    questions: JSON.stringify([
      {
        header: "Direction",
        question: "Which output?",
        options: [
          { label: "Summary", description: "Short." },
          { label: "Full", description: "Long." },
        ],
      },
    ]),
  },
};

export function questionInference() {
  let turn = 0;
  return {
    async chat(_input: ChatInput) {
      turn += 1;
      return turn === 1
        ? chatResult("", [questionCall])
        : chatResult("Finished with your answer.", []);
    },
  };
}

export function successfulInference() {
  let turn = 0;
  return {
    async chat(_input: ChatInput) {
      turn += 1;
      return turn === 1
        ? chatResult("", [{ id: "call-1", name: "python", params: { source: "print('ok')" } }])
        : chatResult("Finished safely.", []);
    },
  };
}

export function pathOnlyInference() {
  let turn = 0;
  return {
    async chat(_input: ChatInput) {
      turn += 1;
      return turn === 1
        ? chatResult("", [{ id: "call-path", name: "python", params: { path: "steps/saved.py" } }])
        : chatResult("Reran the committed script.", []);
    },
  };
}

export async function artifactExecution(
  request: AgentSessionExecution,
): Promise<AgentExecutionResult> {
  if (request.language === "shell") throw new Error("unexpected_shell");
  return {
    language: request.language,
    path: request.path,
    source: request.source ?? "print('resolved path')",
    command: null,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    durationMs: 2,
    termination: "completed",
    artifacts: [
      {
        name: "result.txt",
        mediaType: "text/plain",
        bytesBase64: Buffer.from("result").toString("base64"),
      },
    ],
  };
}

export async function cleanServiceFixtures(): Promise<void> {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
}
