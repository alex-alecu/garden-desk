import { type IncomingMessage, request } from "node:http";
import type { NativeWorkerHandle } from "../native/launcher.js";

export class ServerError extends Error {
  constructor(
    readonly code:
      | "worker_crash"
      | "out_of_memory"
      | "invalid_argument"
      | "malformed_worker_message",
    message = "Local inference failed.",
  ) {
    super(message);
  }
}

export function serverFailure(value: unknown): ServerError {
  const text = JSON.stringify(value);
  if (/out of memory|failed to allocate|alloc.*failed/iu.test(text))
    return new ServerError("out_of_memory");
  if (/context.*(?:exceed|too large)|(?:exceed|larger than).*context/iu.test(text))
    return new ServerError("invalid_argument", "context_size_exceeds_hardware_cap");
  return new ServerError("worker_crash");
}

type EventHandler = (event: unknown) => void;

function dispatchEvent(event: string, onEvent: EventHandler): boolean {
  let done = false;
  for (const line of event.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    const value = JSON.parse(data);
    if (value.error !== undefined) throw serverFailure(value.error);
    onEvent(value);
  }
  return done;
}

function jsonResponse(res: IncomingMessage, text: string): unknown {
  const value = JSON.parse(text);
  if (res.statusCode !== 200 || value.error !== undefined) throw serverFailure(value);
  return value;
}

async function readResponse(res: IncomingMessage, onEvent?: EventHandler): Promise<unknown> {
  let bytes = 0;
  let pending = "";
  let complete = false;
  const streaming =
    onEvent !== undefined && res.headers["content-type"]?.includes("text/event-stream");
  res.setEncoding("utf8");
  for await (const chunk of res) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4 * 1024 ** 2) throw new ServerError("malformed_worker_message");
    pending += chunk;
    if (!streaming) continue;
    const events = pending.split("\n\n");
    pending = events.pop() ?? "";
    for (const event of events) complete = dispatchEvent(event, onEvent) || complete;
  }
  return finishResponse(res, pending, Boolean(streaming), complete);
}

function finishResponse(
  res: IncomingMessage,
  pending: string,
  streaming: boolean,
  complete: boolean,
) {
  if (!streaming) return jsonResponse(res, pending);
  if (res.statusCode !== 200 || !complete) throw new ServerError("worker_crash");
  return undefined;
}

export async function serverRequest(
  handle: NativeWorkerHandle,
  path: string,
  body: unknown,
  options: { signal: AbortSignal; onEvent?: EventHandler },
): Promise<unknown> {
  const connect = handle.connect;
  if (connect === undefined) throw new ServerError("worker_crash");
  const content = body === undefined ? undefined : JSON.stringify(body);
  const res = await new Promise<IncomingMessage>((accept, reject) => {
    const req = request(
      {
        host: "localhost",
        path,
        method: content === undefined ? "GET" : "POST",
        signal: options.signal,
        headers: {
          Connection: "close",
          ...(content === undefined
            ? {}
            : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(content) }),
        },
        createConnection: connect,
      },
      accept,
    );
    req.once("error", reject);
    req.end(content);
  });
  try {
    return await readResponse(res, options.onEvent);
  } catch (error) {
    res.destroy();
    throw error instanceof ServerError ? error : new ServerError("malformed_worker_message");
  }
}
