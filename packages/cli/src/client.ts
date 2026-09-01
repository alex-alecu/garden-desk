import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";
import {
  PROTOCOL_VERSION,
  type RpcRequest,
  type RpcResponse,
  RpcResponseSchema,
} from "@gardendesk/shared";
import { requestWindows } from "./windows-client.js";

const MAX_RESPONSE_BYTES = 192 * 1024 * 1024;

async function verifyEndpoint(endpoint: string): Promise<void> {
  if (process.platform === "win32") return;
  const state = await lstat(endpoint);
  const wrongOwner = process.getuid !== undefined && state.uid !== process.getuid();
  if (!state.isSocket() || wrongOwner || (state.mode & 0o077) !== 0) {
    throw new Error("Daemon endpoint is not restricted to the current user.");
  }
}

export async function request(
  endpoint: string,
  input: Omit<RpcRequest, "jsonrpc" | "protocolVersion"> & { protocolVersion?: number },
): Promise<RpcResponse> {
  const request: RpcRequest = {
    jsonrpc: "2.0",
    protocolVersion: input.protocolVersion ?? PROTOCOL_VERSION,
    id: input.id,
    method: input.method,
    params: input.params,
  };
  const encoded = Buffer.from(`${JSON.stringify(request)}\n`);
  if (process.platform === "win32") {
    const response = await requestWindows(endpoint, encoded, MAX_RESPONSE_BYTES);
    return RpcResponseSchema.parse(JSON.parse(response.toString("utf8")));
  }
  await verifyEndpoint(endpoint);
  return await new Promise((accept, reject) => {
    const socket = createConnection(endpoint);
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy(new Error("Daemon request timed out.")));
    socket.once("connect", () => socket.write(encoded));
    socket.on("data", (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
        socket.destroy(new Error("Daemon response exceeded the protocol limit."));
      }
    });
    socket.once("error", reject);
    socket.once("end", () => {
      try {
        accept(RpcResponseSchema.parse(JSON.parse(response)));
      } catch (error) {
        reject(error);
      }
    });
  });
}
