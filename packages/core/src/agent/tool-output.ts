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

function encodedByteLength(text: string): number {
  return Buffer.byteLength(JSON.stringify(text));
}

function clippedPreview(head: string, tail: string, marker: string): string {
  const headCharacters = Array.from(head);
  const tailCharacters = Array.from(tail);
  let low = 0;
  let high = headCharacters.length + tailCharacters.length;
  let result = `\n\n${marker}\n\n`;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    let headCount = Math.min(headCharacters.length, Math.ceil(count / 2));
    let tailCount = Math.min(tailCharacters.length, count - headCount);
    if (headCount + tailCount < count) {
      headCount = Math.min(headCharacters.length, count - tailCount);
      tailCount = Math.min(tailCharacters.length, count - headCount);
    }
    const candidate = `${headCharacters.slice(0, headCount).join("")}\n\n${marker}\n\n${tailCharacters
      .slice(tailCharacters.length - tailCount)
      .join("")}`;
    if (encodedByteLength(candidate) <= MAX_BYTES) {
      result = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return result;
}

function preview(text: string, marker: string): string | undefined {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES && encodedByteLength(text) <= MAX_BYTES) return undefined;
  const headLines = Math.ceil((MAX_LINES - 4) / 2);
  const tailLines = Math.floor((MAX_LINES - 4) / 2);
  const head = lines.length <= MAX_LINES ? text : lines.slice(0, headLines).join("\n");
  const tail = lines.length <= MAX_LINES ? text : lines.slice(-tailLines).join("\n");
  return clippedPreview(head, tail, marker);
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
  if (text.split("\n").length <= MAX_LINES && encodedByteLength(text) <= MAX_BYTES) return text;
  const path = await spill(executor, text, signal);
  const marker = `[Output truncated. Full output saved to ${path}. Use grep or read with offset/limit.]`;
  return preview(text, marker) ?? text;
}
