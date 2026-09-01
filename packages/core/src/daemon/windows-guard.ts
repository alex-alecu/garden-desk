import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { join } from "node:path";

const MAX_OUTPUT_BYTES = 4096;
const READY_TIMEOUT_MS = 5000;

export interface WindowsPipeGuard {
  close(): Promise<void>;
}

export function windowsPipeGuardPath(): string {
  return join(
    process.cwd(),
    "packages/core/native/windows-pipe-guard/.generated/garden-desk-pipe-guard.exe",
  );
}

function sendResponse(child: ChildProcessWithoutNullStreams, response: Buffer): void {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(response.length);
  child.stdin.write(Buffer.concat([header, response]));
}

function receiveRequests(
  child: ChildProcessWithoutNullStreams,
  respond: (request: Buffer) => Promise<Buffer>,
): void {
  let pending = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE();
      if (pending.length < length + 4) return;
      const request = pending.subarray(4, length + 4);
      pending = pending.subarray(length + 4);
      void respond(request).then((response) => sendResponse(child, response));
    }
  });
}

function closeGuard(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((accept) => {
    if (child.exitCode !== null) return accept();
    child.once("close", () => accept());
    child.kill();
  });
}

export function startWindowsPipeGuard(
  endpoint: string,
  maximumRequestBytes: number,
  respond: (request: Buffer) => Promise<Buffer>,
  executablePath = windowsPipeGuardPath(),
): Promise<WindowsPipeGuard> {
  return new Promise((accept, reject) => {
    const child = spawn(
      executablePath,
      ["serve", endpoint, String(maximumRequestBytes), String(process.pid)],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let errorOutput = "";
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error("Windows pipe guard did not become ready.")),
      READY_TIMEOUT_MS,
    );
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    child.once("error", fail);
    child.once("close", (code) =>
      fail(new Error(errorOutput || `Windows pipe guard exited with ${code}.`)),
    );
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk);
      if (Buffer.byteLength(errorOutput) > MAX_OUTPUT_BYTES) {
        return fail(new Error("Windows pipe guard error output exceeded its limit."));
      }
      if (errorOutput !== "ready\n" || settled) return;
      settled = true;
      clearTimeout(timeout);
      receiveRequests(child, respond);
      accept({ close: () => closeGuard(child) });
    });
  });
}
