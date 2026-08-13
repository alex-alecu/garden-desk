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

function takePrefix(text: string, maximumBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maximumBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function takeSuffix(text: string, maximumBytes: number): string {
  let bytes = 0;
  const result: string[] = [];
  for (const character of Array.from(text).toReversed()) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maximumBytes) break;
    result.unshift(character);
    bytes += size;
  }
  return result.join("");
}

function preview(text: string, marker: string): string | undefined {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return undefined;
  const availableBytes = MAX_BYTES - Buffer.byteLength(marker) - 4;
  const headLines = Math.ceil((MAX_LINES - 4) / 2);
  const tailLines = Math.floor((MAX_LINES - 4) / 2);
  let head = lines.length <= MAX_LINES ? text : lines.slice(0, headLines).join("\n");
  let tail = lines.length <= MAX_LINES ? text : lines.slice(-tailLines).join("\n");
  if (Buffer.byteLength(head) + Buffer.byteLength(tail) > availableBytes) {
    head = takePrefix(head, Math.ceil(availableBytes / 2));
    tail = takeSuffix(tail, Math.floor(availableBytes / 2));
  }
  return `${head}\n\n${marker}\n\n${tail}`;
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
  if (text.split("\n").length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return text;
  const path = await spill(executor, text, signal);
  const marker = `[Output truncated. Full output saved to ${path}. Use grep or read with offset/limit.]`;
  return preview(text, marker) ?? text;
}
