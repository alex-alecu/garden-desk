import { type FileHandle, open, stat, truncate, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentGuestInput, WorkerLimits } from "@gardendesk/shared";
import type { AgentInputFile } from "./launcher.js";

const BLOCK_BYTES = 4096;
const COPY_BUFFER_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export interface PackedAgentInputs {
  devices: string[];
  entries: AgentGuestInput[];
}

function alignedSize(bytes: number): number {
  return Math.max(BLOCK_BYTES, Math.ceil(bytes / BLOCK_BYTES) * BLOCK_BYTES);
}

interface WriteAtInput {
  output: FileHandle;
  buffer: Buffer;
  length: number;
  position: number;
  signal: AbortSignal;
}

async function writeAt(input: WriteAtInput): Promise<void> {
  let written = 0;
  while (written < input.length) {
    input.signal.throwIfAborted();
    const result = await input.output.write(
      input.buffer,
      written,
      input.length - written,
      input.position + written,
    );
    if (result.bytesWritten === 0) throw new Error("worker_input_write_failed");
    written += result.bytesWritten;
  }
}

interface AppendInput {
  input: AgentInputFile;
  output: FileHandle;
  offset: number;
  expectedBytes: number;
  signal: AbortSignal;
}

async function appendInput(options: AppendInput): Promise<void> {
  const { input, output, offset, expectedBytes, signal } = options;
  const source = await open(input.path, "r");
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let copied = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await source.read(buffer, 0, buffer.length);
      if (bytesRead === 0) break;
      if (copied + bytesRead > expectedBytes) throw new Error("input_changed");
      await writeAt({ output, buffer, length: bytesRead, position: offset + copied, signal });
      copied += bytesRead;
    }
    if (copied !== expectedBytes) throw new Error("input_changed");
  } finally {
    await source.close();
  }
}

export async function stagePackedAgentInputs(
  inputs: AgentInputFile[],
  root: string,
  limits: WorkerLimits,
  signal: AbortSignal,
): Promise<PackedAgentInputs> {
  signal.throwIfAborted();
  if (inputs.length > limits.inputCount) throw new Error("worker_input_limit_exceeded");
  if (inputs.length === 0) return { devices: [], entries: [] };
  const volume = join(root, "inputs.img");
  const output = await open(volume, "wx", 0o600);
  const entries: AgentGuestInput[] = [];
  let offset = 0;
  try {
    for (const input of inputs) {
      signal.throwIfAborted();
      const byteLength = (await stat(input.path)).size;
      const nextOffset = offset + alignedSize(byteLength);
      if (byteLength > MAX_FILE_BYTES || nextOffset > limits.inputBytes) {
        throw new Error("worker_input_limit_exceeded");
      }
      await appendInput({ input, output, offset, expectedBytes: byteLength, signal });
      entries.push({ name: input.name, byteLength, deviceIndex: 0, byteOffset: offset });
      offset = nextOffset;
    }
    await output.sync();
    await output.close();
    await truncate(volume, offset);
    return { devices: [volume], entries };
  } catch (error) {
    await output.close().catch(() => undefined);
    await unlink(volume).catch(() => undefined);
    throw error;
  }
}
