import { randomUUID } from "node:crypto";
import type { AgentSessionExecution } from "@vault/workers";
import type { AgentExecutor } from "./agent-executor.js";
import { isSuccessfulExecution } from "./execution-success.js";

const MAX_LINES = 2_000;
const MAX_BYTES = 50 * 1_024;
const CHUNK_BYTES = 48 * 1_024;
const HEAD_LINES = Math.ceil((MAX_LINES - 4) / 2);
const TAIL_LINES = Math.floor((MAX_LINES - 4) / 2);

interface OutputChunk {
  executor: AgentExecutor;
  path: string;
  bytes: Buffer;
  append: boolean;
  signal?: AbortSignal;
}

function characterWidth(text: string, index: number): number {
  const first = text.charCodeAt(index);
  const second = text.charCodeAt(index + 1);
  return first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1;
}

function jsonCharacterBytes(text: string, index: number, width: number): number {
  if (width === 2) return 4;
  const code = text.charCodeAt(index);
  if (
    code === 0x22 ||
    code === 0x5c ||
    code === 0x08 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d
  ) {
    return 2;
  }
  if (code <= 0x1f || (code >= 0xd800 && code <= 0xdfff)) return 6;
  if (code <= 0x7f) return 1;
  return code <= 0x7ff ? 2 : 3;
}

function jsonContentBytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; ) {
    const width = characterWidth(text, index);
    bytes += jsonCharacterBytes(text, index, width);
    index += width;
  }
  return bytes;
}

interface OutputShape {
  encodedBytes: number;
  head: string;
  lineCount: number;
  tail: string;
}

function outputShape(text: string): OutputShape {
  const tailStarts = new Array<number>(TAIL_LINES);
  tailStarts[0] = 0;
  let contentBytes = 0;
  let headEnd = text.length;
  let lineCount = 1;
  for (let index = 0; index < text.length; ) {
    const width = characterWidth(text, index);
    contentBytes += jsonCharacterBytes(text, index, width);
    if (text.charCodeAt(index) === 0x0a) {
      if (lineCount === HEAD_LINES) headEnd = index;
      lineCount += 1;
      tailStarts[(lineCount - 1) % TAIL_LINES] = index + 1;
    }
    index += width;
  }
  if (lineCount <= MAX_LINES) {
    return { encodedBytes: contentBytes + 2, head: text, lineCount, tail: text };
  }
  const tailStart = tailStarts[(lineCount - TAIL_LINES) % TAIL_LINES] ?? text.length;
  return {
    encodedBytes: contentBytes + 2,
    head: text.slice(0, headEnd),
    lineCount,
    tail: text.slice(tailStart),
  };
}

interface PrefixSlice {
  bytes: number;
  end: number;
}

function extendPrefix(text: string, current: PrefixSlice, byteLimit: number): PrefixSlice {
  let { bytes, end } = current;
  while (end < text.length) {
    const width = characterWidth(text, end);
    const nextBytes = jsonCharacterBytes(text, end, width);
    if (bytes + nextBytes > byteLimit) break;
    bytes += nextBytes;
    end += width;
  }
  return { bytes, end };
}

interface SuffixSlice {
  bytes: number;
  start: number;
}

function previousCharacterStart(text: string, end: number): number {
  const last = text.charCodeAt(end - 1);
  const previous = text.charCodeAt(end - 2);
  return last >= 0xdc00 && last <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
    ? end - 2
    : end - 1;
}

function extendSuffix(text: string, current: SuffixSlice, byteLimit: number): SuffixSlice {
  let { bytes, start } = current;
  while (start > 0) {
    const nextStart = previousCharacterStart(text, start);
    const nextBytes = jsonCharacterBytes(text, nextStart, start - nextStart);
    if (bytes + nextBytes > byteLimit) break;
    bytes += nextBytes;
    start = nextStart;
  }
  return { bytes, start };
}

function clippedPreview(head: string, tail: string, marker: string): string {
  const separator = `\n\n${marker}\n\n`;
  const availableBytes = Math.max(0, MAX_BYTES - 2 - jsonContentBytes(separator));
  let prefix = extendPrefix(head, { bytes: 0, end: 0 }, Math.ceil(availableBytes / 2));
  let suffix = extendSuffix(tail, { bytes: 0, start: tail.length }, Math.floor(availableBytes / 2));
  let remaining = availableBytes - prefix.bytes - suffix.bytes;
  prefix = extendPrefix(head, prefix, prefix.bytes + remaining);
  remaining = availableBytes - prefix.bytes - suffix.bytes;
  suffix = extendSuffix(tail, suffix, suffix.bytes + remaining);
  return `${head.slice(0, prefix.end)}${separator}${tail.slice(suffix.start)}`;
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
  if (!isSuccessfulExecution(result)) {
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
  const shape = outputShape(text);
  if (shape.lineCount <= MAX_LINES && shape.encodedBytes <= MAX_BYTES) return text;
  const path = await spill(executor, text, signal);
  const marker = `[Output truncated. Full output saved to ${path}. Use grep or read with offset/limit.]`;
  return clippedPreview(shape.head, shape.tail, marker);
}
