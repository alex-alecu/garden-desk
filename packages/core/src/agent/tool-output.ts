import { randomUUID } from "node:crypto";
import type { AgentSessionExecution } from "@vault/workers";
import type { AgentExecutor } from "./agent-executor.js";

const MAX_LINES = 2_000;
const MAX_BYTES = 50 * 1_024;
const CHUNK_BYTES = 48 * 1_024;

interface OutputChunk {
  executor: AgentExecutor;
  path: string;
  bytes: Buffer;
  append: boolean;
  signal?: AbortSignal;
}

function preview(text: string): string | undefined {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return undefined;
  let bytes = 0;
  const kept: string[] = [];
  for (const line of lines.slice(0, MAX_LINES)) {
    const next = Buffer.byteLength(`${line}\n`);
    if (bytes + next > MAX_BYTES) break;
    kept.push(line);
    bytes += next;
  }
  return kept.join("\n");
}

async function writeChunk(chunk: OutputChunk): Promise<void> {
  const source = [
    "from pathlib import Path",
    "import base64",
    `path = Path(${JSON.stringify(chunk.path)})`,
    "path.parent.mkdir(parents=True, exist_ok=True)",
    `with path.open(${JSON.stringify(chunk.append ? "ab" : "wb")}) as handle:`,
    `    handle.write(base64.b64decode(${JSON.stringify(chunk.bytes.toString("base64"))}))`,
  ].join("\n");
  const execution: AgentSessionExecution = {
    language: "python",
    path: `.vault-output/write-${randomUUID()}.py`,
    source,
  };
  const result = await (chunk.executor.inspect ?? chunk.executor.execute)(execution, chunk.signal);
  if (result.termination !== "completed" || result.exitCode !== 0) {
    throw new Error("tool_output_spill_failed");
  }
}

async function spill(executor: AgentExecutor, text: string, signal?: AbortSignal): Promise<string> {
  const path = `/workspace/.vault-output/${randomUUID()}.txt`;
  const bytes = Buffer.from(text, "utf8");
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    await writeChunk({
      executor,
      path,
      bytes: bytes.subarray(offset, offset + CHUNK_BYTES),
      append: offset > 0,
      ...(signal === undefined ? {} : { signal }),
    });
  }
  return path;
}

export async function boundedToolOutput(
  executor: AgentExecutor,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const head = preview(text);
  if (head === undefined) return text;
  const path = await spill(executor, text, signal);
  return `${head}\n\n[Output truncated. Full output saved to ${path}. Use grep or read with offset/limit.]`;
}
