import { type WorkerFrame, WorkerFrameSchema } from "@gardendesk/shared";

const HEADER_BYTES = 4;
const MAX_FRAME_BYTES = 192 * 1024 * 1024;

export function encodeFrame(frame: WorkerFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(WorkerFrameSchema.parse(frame)));
  if (payload.length > MAX_FRAME_BYTES) throw new Error("Worker frame exceeds size limit.");
  const encoded = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  encoded.writeUInt32BE(payload.length, 0);
  payload.copy(encoded, HEADER_BYTES);
  return encoded;
}

export function decodeFrame(encoded: Buffer): WorkerFrame {
  if (encoded.length < HEADER_BYTES) throw new Error("Incomplete worker frame header.");
  const length = encoded.readUInt32BE(0);
  if (length === 0 || length > MAX_FRAME_BYTES || encoded.length !== length + HEADER_BYTES) {
    throw new Error("Invalid worker frame length.");
  }
  return WorkerFrameSchema.parse(JSON.parse(encoded.subarray(HEADER_BYTES).toString("utf8")));
}

export class FrameDecoder {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;
  private expectedLength: number | undefined;

  private consume(length: number): Buffer {
    const parts: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      const first = this.chunks[0];
      if (first === undefined) throw new Error("Incomplete worker frame.");
      if (first.length <= remaining) {
        parts.push(first);
        this.chunks.shift();
        remaining -= first.length;
      } else {
        parts.push(first.subarray(0, remaining));
        this.chunks[0] = first.subarray(remaining);
        remaining = 0;
      }
    }
    this.byteLength -= length;
    return parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts, length);
  }

  private nextFrame(): WorkerFrame | undefined {
    if (this.expectedLength === undefined) {
      if (this.byteLength < HEADER_BYTES) return undefined;
      this.expectedLength = this.consume(HEADER_BYTES).readUInt32BE(0);
      if (this.expectedLength === 0 || this.expectedLength > MAX_FRAME_BYTES) {
        throw new Error("Invalid worker frame length.");
      }
    }
    if (this.byteLength < this.expectedLength) return undefined;
    const payload = this.consume(this.expectedLength);
    this.expectedLength = undefined;
    return WorkerFrameSchema.parse(JSON.parse(payload.toString("utf8")));
  }

  push(chunk: Buffer): WorkerFrame[] {
    this.chunks.push(chunk);
    this.byteLength += chunk.length;
    const frames: WorkerFrame[] = [];
    while (true) {
      const frame = this.nextFrame();
      if (frame === undefined) break;
      frames.push(frame);
    }
    return frames;
  }
}
