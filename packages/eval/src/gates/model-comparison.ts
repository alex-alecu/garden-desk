import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import {
  createWindowsInferenceRuntime,
  MacOsNativeWorkerLauncher,
  type NativeWorkerLauncher,
  serverRequest,
  startServer,
} from "@gardendesk/workers";
import {
  type ChoiceCase,
  choiceCases,
  type ToolCase,
  toolCases,
} from "./model-comparison-cases.js";
import { actionTools, inspectionTools, primaryPrompt, taskTool } from "./model-comparison-tools.js";

type Json = Record<string, unknown>;
interface Server {
  ask(path: string, body: unknown): Promise<Json>;
  memory(): Json;
  stop(): Promise<void>;
}
interface Timings {
  prompt_n?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_per_second?: number;
  draft_n?: number;
  draft_n_accepted?: number;
}
interface ToolCall {
  function?: { name?: string; arguments?: string };
}

const repository = process.cwd();
const signal = AbortSignal.timeout(90 * 60_000);
const speculation = (argument("--speculation") ?? "none") as "none" | "ngram-mod";
const label = argument("--label") ?? INFERENCE_PROFILE.modelId;
const url = argument("--url");
const modelPath =
  argument("--model") ??
  join(repository, "packages/eval/.generated/models", `${INFERENCE_PROFILE.modelId}.gguf`);
const runtimeDirectory =
  argument("--runtime") ??
  join(
    repository,
    "packages/eval/.generated/inference",
    process.platform === "win32" ? "windows-cuda-x64" : "macos-arm64",
  );
const contexts = (argument("--contexts") ?? String(INFERENCE_PROFILE.minimumContextTokens))
  .split(",")
  .map(Number);
const outputDirectory = join(repository, "packages/eval/.generated/model-comparison");
const thinking = { chat_template_kwargs: { enable_thinking: false } };

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function launcher(): Promise<NativeWorkerLauncher> {
  if (process.platform === "win32") {
    const runtime = await createWindowsInferenceRuntime({
      inferenceHelperPath: join(
        repository,
        "packages/workers/native/windows-appcontainer-launcher/.generated/garden-desk-appcontainer-launcher.exe",
      ),
      inferenceRuntimePath: join(runtimeDirectory, "llama-server.exe"),
      workerEntryPath: "",
    });
    return runtime.workerLauncher;
  }
  return new MacOsNativeWorkerLauncher([], join(runtimeDirectory, "llama-server"));
}

async function openServer(contextTokens: number): Promise<Server & { loadMs: number }> {
  const began = Date.now();
  if (url !== undefined) {
    return {
      loadMs: 0,
      async ask(path, body) {
        const response = await fetch(new URL(path, url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        return (await response.json()) as Json;
      },
      memory: () => ({}),
      stop: async () => {},
    };
  }
  const handle = await startServer(
    await launcher(),
    "",
    {
      modelPath,
      memoryBudgetBytes: INFERENCE_PROFILE.memoryBudgetBytes,
      contextTokens,
      speculation,
    },
    signal,
  );
  return {
    loadMs: Date.now() - began,
    ask: async (path, body) => (await serverRequest(handle, path, body, { signal })) as Json,
    memory: () => handle.memory() as Json,
    stop: () => handle.dispose(),
  };
}

function timings(reply: Json): Timings {
  return (reply.timings ?? {}) as Timings;
}

function firstCall(reply: Json): { name: string; params: Json } | undefined {
  const message = (
    reply.choices as Array<{ message?: { tool_calls?: ToolCall[] } }> | undefined
  )?.[0]?.message;
  const call = message?.tool_calls?.[0]?.function;
  if (call?.name === undefined) return undefined;
  try {
    return { name: call.name, params: JSON.parse(call.arguments ?? "{}") as Json };
  } catch {
    return { name: call.name, params: { malformed: call.arguments } };
  }
}

async function chat(server: Server, body: Json): Promise<Json> {
  return await server.ask("/v1/chat/completions", { temperature: 0, ...body });
}

async function throughput(server: Server) {
  const code =
    "Implement quicksort in Python with type hints and a docstring, then explain its time and memory complexity.";
  const prose =
    "Write a plain-language explanation of about 400 words on how a notice period in a lease agreement works.";
  const results: Json = {};
  for (const [name, content, extra] of [
    ["code", code, thinking],
    ["prose", prose, thinking],
    ["code_thinking", code, {}],
  ] as const) {
    const reply = await chat(server, {
      messages: [{ role: "user", content }],
      max_tokens: 1024,
      ...extra,
    });
    results[name] = timings(reply);
  }
  const corpus = Array.from(
    { length: 1000 },
    (_, index) =>
      `Record ${index}: department=${["sales", "support", "research", "operations"][index % 4]}, units=${(index % 97) + 1}, cost=${(index % 53) + 10}, note=${["paid", "open", "disputed"][index % 3]}.`,
  ).join("\n");
  const reply = await chat(server, {
    messages: [
      {
        role: "user",
        content: `${corpus}\nWhich department has the highest total cost? Answer in one sentence.`,
      },
    ],
    max_tokens: 64,
    ...thinking,
  });
  results.long_prefill = { ...timings(reply), usage: reply.usage };
  return results;
}

function scoreTool(item: ToolCase, call: ReturnType<typeof firstCall>): boolean {
  if (item.expectedTool === null) return call === undefined;
  if (call?.name !== item.expectedTool) return false;
  if (item.argument === undefined) return true;
  return item.argument.pattern.test(String(call.params[item.argument.name] ?? ""));
}

async function toolPrecision(server: Server) {
  const system =
    "You are Garden Desk, a local coworker. The user's files are under /source, read-only. Save work under /workspace. Use a tool when the request needs one; otherwise answer directly.";
  const tools = [...inspectionTools(), ...actionTools(), await taskTool()];
  const rows = [];
  for (const item of toolCases) {
    const reply = await chat(server, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: item.request },
      ],
      tools,
      max_tokens: 1024,
    });
    const call = firstCall(reply);
    rows.push({ id: item.id, correct: scoreTool(item, call), call, timings: timings(reply) });
  }
  return { precision: rows.filter((row) => row.correct).length / rows.length, rows };
}

function scoreChoice(item: ChoiceCase, call: ReturnType<typeof firstCall>): boolean {
  if (call?.name !== item.expectedTool) return false;
  return item.expectedSubagent === undefined || call.params.subagent_type === item.expectedSubagent;
}

async function specialistChoice(server: Server) {
  const system = await primaryPrompt();
  const tools = [...inspectionTools(), ...actionTools(), await taskTool()];
  const rows = [];
  for (const item of choiceCases) {
    const reply = await chat(server, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: item.request },
      ],
      tools,
      max_tokens: 2048,
    });
    const call = firstCall(reply);
    rows.push({
      id: item.id,
      correct: scoreChoice(item, call),
      call: call && { name: call.name, subagent_type: call.params.subagent_type },
      timings: timings(reply),
    });
  }
  return { precision: rows.filter((row) => row.correct).length / rows.length, rows };
}

const report: Json = {
  label,
  modelPath: url ?? modelPath,
  runtime: url ?? runtimeDirectory,
  speculation,
  platform: process.platform,
  startedAt: new Date().toISOString(),
  contexts: [] as Json[],
};
await mkdir(outputDirectory, { recursive: true });
const reportPath = resolve(outputDirectory, `${label}.json`);
try {
  for (const [index, contextTokens] of contexts.entries()) {
    const server = await openServer(contextTokens);
    try {
      const entry: Json = { contextTokens, loadMs: server.loadMs, memory: server.memory() };
      (report.contexts as Json[]).push(entry);
      console.log(
        JSON.stringify({
          stage: "loaded",
          contextTokens,
          loadMs: server.loadMs,
          memory: entry.memory,
        }),
      );
      if (index === 0) {
        report.throughput = await throughput(server);
        console.log(JSON.stringify({ stage: "throughput", throughput: report.throughput }));
        report.toolPrecision = await toolPrecision(server);
        console.log(
          JSON.stringify({
            stage: "tool_precision",
            precision: (report.toolPrecision as Json).precision,
          }),
        );
        report.specialistChoice = await specialistChoice(server);
        console.log(
          JSON.stringify({
            stage: "specialist_choice",
            precision: (report.specialistChoice as Json).precision,
          }),
        );
      }
    } finally {
      await server.stop();
    }
  }
  report.result = "completed";
} catch (error) {
  report.result = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ stage: "finished", result: report.result, reportPath }));
}
