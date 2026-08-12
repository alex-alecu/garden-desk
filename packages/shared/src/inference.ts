import { z } from "zod";
import { VaultErrorSchema } from "./errors.js";
import { JobIdSchema, RequestIdSchema } from "./ids.js";

export const InferenceProfileSchema = z.enum(["auto", "local12", "local16"]);
export const InferenceOperationSchema = z.enum(["generate", "chat", "embed", "probe"]);
export const GenerationContextLimitReasonSchema = z.enum([
  "mac_unified_memory_at_most_32_gib",
  "mac_unified_memory_above_32_gib",
  "windows_gpu_vram_at_most_24_gib",
  "windows_gpu_vram_above_24_gib",
  "certified_standard",
]);

const JsonSchemaSchema = z.record(z.string(), z.unknown());
export const MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS = 256_054;
export const MAX_GENERATION_TOKENS = 32_768;
const RequestBaseSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: RequestIdSchema,
  jobId: JobIdSchema,
});

export const StructuredGenerationRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("generate"),
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS),
  jsonSchema: JsonSchemaSchema,
  contextSize: z.union([z.literal("auto"), z.number().int().min(512).max(131_072)]),
  maxTokens: z.number().int().positive().max(MAX_GENERATION_TOKENS),
});

/**
 * Conversational tool-calling protocol. Core owns the full message history and
 * executes every tool itself (in the no-NIC guest); the worker only converts the
 * history into the model's native chat format, generates one assistant turn, and
 * returns its text plus the tool calls the model wants Core to run next.
 */
export const MAX_CHAT_MESSAGES = 4_096;
export const MAX_CHAT_TOOLS = 32;

export const ChatToolCallSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  params: z.unknown(),
});

export const ChatMessageSchema = z.union([
  z.object({
    role: z.literal("system"),
    text: z.string().max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS),
  }),
  z.object({
    role: z.literal("user"),
    text: z.string().max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS),
  }),
  z.object({
    role: z.literal("assistant"),
    text: z.string().max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS).default(""),
    toolCalls: z.array(ChatToolCallSchema).max(MAX_CHAT_TOOLS).default([]),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().min(1).max(128),
    name: z.string().min(1).max(64),
    result: z.string().max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS),
  }),
]);

export const ChatToolDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(4_096),
  params: JsonSchemaSchema,
});

export const ChatGenerationRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("chat"),
  modelId: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1).max(MAX_CHAT_MESSAGES),
  tools: z.array(ChatToolDefinitionSchema).max(MAX_CHAT_TOOLS).default([]),
  contextSize: z.union([z.literal("auto"), z.number().int().min(512).max(131_072)]),
  maxTokens: z.number().int().positive().max(MAX_GENERATION_TOKENS),
  temperature: z.number().min(0).max(2),
});

export const EmbeddingRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("embed"),
  modelId: z.string().min(1),
  input: z.string().min(1).max(256_000),
  contextSize: z.number().int().min(128).max(32_768),
});

export const NativeWorkerProbeRequestSchema = RequestBaseSchema.extend({
  operation: z.literal("probe"),
  authorityProbePath: z.string().min(1),
  outOfScopeReadPath: z.string().min(1),
  outOfScopeWritePath: z.string().min(1),
});

export const InferenceWorkerRequestSchema = z.discriminatedUnion("operation", [
  StructuredGenerationRequestSchema,
  ChatGenerationRequestSchema,
  EmbeddingRequestSchema,
  NativeWorkerProbeRequestSchema,
]);

export const InferenceMemoryReportSchema = z.object({
  cpuRamBytes: z.number().int().nonnegative(),
  gpuVramBytes: z.number().int().nonnegative(),
  budgetBytes: z.number().int().positive(),
  detectedGpuVramBytes: z.number().int().nonnegative(),
  contextSizeTokens: z.number().int().positive().optional(),
  contextLimitTokens: z.number().int().positive().optional(),
  contextLimitReason: GenerationContextLimitReasonSchema.optional(),
});

export const InferencePerformanceSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  promptDurationMs: z.number().int().nonnegative(),
  generationDurationMs: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});

const ResponseBaseSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: RequestIdSchema,
  status: z.literal("ok"),
});

export const StructuredGenerationResultSchema = ResponseBaseSchema.extend({
  operation: z.literal("generate"),
  value: z.unknown(),
  memory: InferenceMemoryReportSchema,
  performance: InferencePerformanceSchema,
});

export const ChatGenerationResultSchema = ResponseBaseSchema.extend({
  operation: z.literal("chat"),
  text: z.string().max(MAX_EFFECTIVE_GENERATION_PROMPT_CHARACTERS),
  toolCalls: z.array(ChatToolCallSchema).max(MAX_CHAT_TOOLS).default([]),
  stopReason: z.enum(["toolCalls", "text", "maxTokens"]),
  memory: InferenceMemoryReportSchema,
  performance: InferencePerformanceSchema,
});

export const EmbeddingResultSchema = ResponseBaseSchema.extend({
  operation: z.literal("embed"),
  vector: z.array(z.number().finite()).min(1),
  memory: InferenceMemoryReportSchema,
});

export const NativeWorkerProbeResultSchema = ResponseBaseSchema.extend({
  operation: z.literal("probe"),
  networkDenied: z.literal(true),
  credentialEnvironmentAbsent: z.literal(true),
  shellEnvironmentAbsent: z.literal(true),
  workspaceDenied: z.literal(true),
  outOfScopeReadDenied: z.literal(true),
  outOfScopeWriteDenied: z.literal(true),
  executableToolsDenied: z.literal(true),
  nodeReexecDenied: z.literal(true),
});

export const InferenceWorkerFailureSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: RequestIdSchema,
  status: z.literal("error"),
  error: VaultErrorSchema,
});

export const InferenceWorkerThinkingEventSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: RequestIdSchema,
  status: z.literal("stream"),
  event: z.literal("thinking.delta"),
  text: z.string().min(1).max(4_096),
});

export const InferenceWorkerResponseSchema = z.union([
  StructuredGenerationResultSchema,
  ChatGenerationResultSchema,
  EmbeddingResultSchema,
  NativeWorkerProbeResultSchema,
  InferenceWorkerFailureSchema,
]);

export const InferenceWorkerMessageSchema = z.union([
  InferenceWorkerResponseSchema,
  InferenceWorkerThinkingEventSchema,
]);

export type InferenceProfile = z.infer<typeof InferenceProfileSchema>;
export type InferenceOperation = z.infer<typeof InferenceOperationSchema>;
export type GenerationContextLimitReason = z.infer<typeof GenerationContextLimitReasonSchema>;
export type StructuredGenerationRequest = z.infer<typeof StructuredGenerationRequestSchema>;
export type ChatGenerationRequest = z.infer<typeof ChatGenerationRequestSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;
export type ChatToolDefinition = z.infer<typeof ChatToolDefinitionSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type NativeWorkerProbeRequest = z.infer<typeof NativeWorkerProbeRequestSchema>;
export type InferenceWorkerRequest = z.infer<typeof InferenceWorkerRequestSchema>;
export type InferenceWorkerResponse = z.infer<typeof InferenceWorkerResponseSchema>;
export type InferenceWorkerMessage = z.infer<typeof InferenceWorkerMessageSchema>;
export type InferencePerformance = z.infer<typeof InferencePerformanceSchema>;
export type StructuredGenerationResult = z.infer<typeof StructuredGenerationResultSchema>;
export type ChatGenerationResult = z.infer<typeof ChatGenerationResultSchema>;
export type EmbeddingResult = z.infer<typeof EmbeddingResultSchema>;
