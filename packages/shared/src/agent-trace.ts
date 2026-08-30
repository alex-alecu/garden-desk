import { z } from "zod";
import {
  AgentInferenceTurnIdSchema,
  AgentRunIdSchema,
  ContentHashSchema,
  JobIdSchema,
  RequestIdSchema,
} from "./ids.js";

const MAX_TRACE_PROMPT_CHARACTERS = 32 * 1_024 * 1_024;

export const AgentInferencePhaseSchema = z.enum([
  "decision",
  "final_response",
  "chat",
  "compaction",
]);
export const AgentInferenceOutcomeSchema = z.enum([
  "accepted_execution",
  "accepted_response",
  "accepted_skill_request",
  "accepted_tool_calls",
  "accepted_compaction",
  // Historical values kept only so existing local trace catalogs still parse.
  "rejected_duplicate",
  "rejected_unbacked_response",
  "invalid_response",
  "inference_failed",
  "cancelled",
  "interrupted",
]);

export const AgentInferenceTurnSchema = z.object({
  id: AgentInferenceTurnIdSchema,
  runId: AgentRunIdSchema,
  sequence: z.number().int().nonnegative(),
  phase: AgentInferencePhaseSchema,
  requestId: RequestIdSchema,
  jobId: JobIdSchema,
  modelId: z.string().min(1),
  contextSize: z.union([z.literal("auto"), z.number().int().positive()]),
  maxTokens: z.number().int().positive(),
  allocatedContextTokens: z.number().int().positive().nullable(),
  promptHash: ContentHashSchema,
  schemaHash: ContentHashSchema,
  responseHash: ContentHashSchema.nullable(),
  prompt: z.string().min(1).max(MAX_TRACE_PROMPT_CHARACTERS),
  jsonSchema: z.record(z.string(), z.unknown()),
  structuredResponse: z.unknown().nullable(),
  outcome: AgentInferenceOutcomeSchema.nullable(),
  executionSequence: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  responseCapturedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const AgentTraceSchema = z.discriminatedUnion("captureVersion", [
  z.object({
    runId: AgentRunIdSchema,
    captureVersion: z.literal(0),
    status: z.literal("not_recorded"),
    turns: z.tuple([]),
  }),
  z.object({
    runId: AgentRunIdSchema,
    captureVersion: z.literal(1),
    status: z.literal("recorded"),
    turns: z.array(AgentInferenceTurnSchema).max(1_000),
  }),
]);

export type AgentInferencePhase = z.infer<typeof AgentInferencePhaseSchema>;
export type AgentInferenceOutcome = z.infer<typeof AgentInferenceOutcomeSchema>;
export type AgentInferenceTurn = z.infer<typeof AgentInferenceTurnSchema>;
export type AgentTrace = z.infer<typeof AgentTraceSchema>;
