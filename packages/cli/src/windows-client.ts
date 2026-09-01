import { spawn } from "node:child_process";
import { join } from "node:path";

const MAX_ERROR_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 10_000;

function helperPath(): string {
  return join(
    process.cwd(),
    "packages/core/native/windows-pipe-guard/.generated/garden-desk-pipe-guard.exe",
  );
}

export function requestWindows(
  endpoint: string,
  request: Buffer,
  maximumResponseBytes: number,
): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const child = spawn(helperPath(), ["request", endpoint, String(maximumResponseBytes)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let errorOutput = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error("Daemon request timed out.")),
      REQUEST_TIMEOUT_MS,
    );
    child.once("error", fail);
    child.stdin.once("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumResponseBytes)
        return fail(new Error("Daemon response exceeded the protocol limit."));
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk);
      if (Buffer.byteLength(errorOutput) > MAX_ERROR_BYTES)
        return fail(new Error("Windows pipe client error output exceeded its limit."));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) accept(Buffer.concat(output));
      else reject(new Error(errorOutput.trim() || `Windows pipe client exited with ${code}.`));
    });
    child.stdin.end(request);
  });
}
