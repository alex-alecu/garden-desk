import { z } from "zod";
import { GardenDeskErrorSchema } from "./errors.js";
import { RequestIdSchema } from "./ids.js";

export const PROTOCOL_VERSION = 1 as const;
export const LocalEndpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unix_socket"), address: z.string().min(1) }),
  z.object({ kind: z.literal("named_pipe"), address: z.string().min(1) }),
]);
export const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestIdSchema,
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  protocolVersion: z.number().int().positive(),
});

export const RpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestIdSchema,
  result: z.unknown(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const RpcFailureSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: RequestIdSchema.nullable(),
  error: GardenDeskErrorSchema,
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const RpcResponseSchema = z.union([RpcSuccessSchema, RpcFailureSchema]);
export type RpcRequest = z.infer<typeof RpcRequestSchema>;
export type RpcResponse = z.infer<typeof RpcResponseSchema>;
