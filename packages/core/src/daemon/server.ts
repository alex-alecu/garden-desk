import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join, resolve } from "node:path";
import type { GardenDeskCore } from "../facade.js";
import { dispatchRpc } from "./methods.js";
import { startWindowsPipeGuard } from "./windows-guard.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface GardenDeskDaemon {
  endpoint: string;
  close(): Promise<void>;
}

export interface DaemonOptions {
  windowsPipeGuardPath?: string;
}

export function daemonEndpoint(workspaceDir: string): string {
  const workspaceRoot = realpathSync.native(resolve(workspaceDir));
  if (process.platform === "win32") {
    const name = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 32);
    return `\\\\.\\pipe\\garden-desk-cored-${name}`;
  }
  return join(workspaceRoot, ".garden-desk", "core.sock");
}

function endpointIsLive(endpoint: string): Promise<boolean> {
  return new Promise((accept) => {
    const socket = createConnection(endpoint);
    let settled = false;
    const finish = (live: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      accept(live);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function removeStaleSocket(endpoint: string): Promise<void> {
  try {
    const state = await lstat(endpoint);
    if (!state.isSocket() || (process.getuid !== undefined && state.uid !== process.getuid())) {
      throw new Error("Refusing to replace a non-owned daemon endpoint.");
    }
    if (await endpointIsLive(endpoint)) throw new Error("workspace_busy");
    await unlink(endpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function secureEndpointDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const state = await lstat(path);
  const wrongOwner = process.getuid !== undefined && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || wrongOwner) {
    throw new Error("Daemon endpoint directory is unsafe.");
  }
  await chmod(path, 0o700);
}

async function respond(core: GardenDeskCore, request: Buffer): Promise<Buffer> {
  if (request.byteLength > MAX_REQUEST_BYTES) return Buffer.alloc(0);
  const newline = request.indexOf("\n");
  if (newline === -1) return Buffer.alloc(0);
  let input: unknown;
  try {
    input = JSON.parse(request.subarray(0, newline).toString("utf8"));
  } catch {
    input = undefined;
  }
  const response = await dispatchRpc(core, input);
  return Buffer.from(`${JSON.stringify(response)}\n`);
}

function serveSocket(core: GardenDeskCore, socket: Socket): void {
  let pending = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAX_REQUEST_BYTES) return socket.destroy();
    const newline = pending.indexOf("\n");
    if (newline === -1) return;
    const line = pending.slice(0, newline);
    pending = "";
    let input: unknown;
    try {
      input = JSON.parse(line);
    } catch {
      input = undefined;
    }
    void dispatchRpc(core, input).then((response) => socket.end(`${JSON.stringify(response)}\n`));
  });
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      accept();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((accept, reject) => {
    server.close((error) => (error === undefined ? accept() : reject(error)));
  });
}

export async function startDaemon(
  core: GardenDeskCore,
  workspaceDir: string,
  options: DaemonOptions = {},
): Promise<GardenDeskDaemon> {
  const endpoint = daemonEndpoint(workspaceDir);
  if (process.platform === "win32") {
    const guard = await startWindowsPipeGuard(
      endpoint,
      MAX_REQUEST_BYTES,
      (request) => respond(core, request),
      options.windowsPipeGuardPath,
    );
    return { endpoint, close: () => guard.close() };
  }
  await secureEndpointDirectory(join(resolve(workspaceDir), ".garden-desk"));
  await removeStaleSocket(endpoint);
  const server = createServer((socket) => serveSocket(core, socket));
  await listen(server, endpoint);
  await chmod(endpoint, 0o600);
  return {
    endpoint,
    close: async () => {
      await closeServer(server);
      await unlink(endpoint).catch(() => undefined);
    },
  };
}
