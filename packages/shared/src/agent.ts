import { z } from "zod";
import {
  AgentArtifactIdSchema,
  AgentEventIdSchema,
  AgentExecutionIdSchema,
  AgentRunIdSchema,
  ContentHashSchema,
  JobIdSchema,
  SessionIdSchema,
} from "./ids.js";
import { InferencePerformanceSchema } from "./inference.js";

export const AgentLanguageSchema = z.enum(["python", "node", "shell"]);

export const AgentWorkspacePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
    "unsafe_workspace_path",
  );

const AgentSkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const AgentRequestedSkillsSchema = z.array(AgentSkillNameSchema).max(8).optional();

export const AgentDecisionSchema = z.union([
  z.discriminatedUnion("language", [
    z.object({
      action: z.literal("execute"),
      language: z.enum(["python", "node"]),
      path: AgentWorkspacePathSchema.optional(),
      skills: AgentRequestedSkillsSchema,
      source: z.string().min(1).max(128_000),
      summary: z.string().min(1).max(500),
    }),
    z.object({
      action: z.literal("execute"),
      language: z.literal("shell"),
      command: z.string().min(1).max(128_000),
      skills: AgentRequestedSkillsSchema,
      summary: z.string().min(1).max(500),
    }),
  ]),
  z
    .object({
      action: z.literal("respond"),
      response: z.string().min(1).max(64_000),
      artifacts: z.array(AgentWorkspacePathSchema).max(16).optional(),
      skills: AgentRequestedSkillsSchema,
    })
    .superRefine((decision, context) => {
      if (
        decision.artifacts !== undefined &&
        new Set(decision.artifacts).size !== decision.artifacts.length
      ) {
        context.addIssue({ code: "custom", message: "duplicate_artifact_path" });
      }
    }),
]);

const AgentExecutionEvidenceSchema = z.object({
  exitCode: z.number().int().min(0).max(255),
  stdout: z.string().max(1_000_000),
  stderr: z.string().max(1_000_000),
  stdoutTruncated: z.boolean().optional(),
  stderrTruncated: z.boolean().optional(),
  durationMs: z.number().int().nonnegative(),
  termination: z.enum(["completed", "timeout", "cancelled", "resource_limit", "crash"]),
  artifacts: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        mediaType: z.string().min(1).max(255),
        bytesBase64: z.string().max(16 * 1024 * 1024),
      }),
    )
    .max(16)
    .default([]),
  invalidatedArtifactPaths: z.array(AgentWorkspacePathSchema).max(20_000).optional(),
});

export const AgentExecutionResultSchema = z.discriminatedUnion("language", [
  AgentExecutionEvidenceSchema.extend({
    language: z.enum(["python", "node"]),
    path: AgentWorkspacePathSchema,
    source: z.string().min(1).max(128_000),
    command: z.null(),
  }),
  AgentExecutionEvidenceSchema.extend({
    language: z.literal("shell"),
    path: z.null(),
    source: z.null(),
    command: z.string().min(1).max(128_000),
  }),
]);

export const AgentRunResultSchema = z.object({
  response: z.string().min(1),
  artifacts: z.array(AgentWorkspacePathSchema).max(16).default([]),
  executions: z.array(AgentExecutionResultSchema).max(6),
  inference: InferencePerformanceSchema,
});

export const AgentRunPerformanceSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  tokensPerSecond: z.number().finite().nonnegative(),
  promptTokensPerSecond: z.number().finite().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});

export const AgentRunStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const AgentVmDiagnosticCodeSchema = z.enum([
  "staging",
  "vm_start",
  "guest_connection",
  "process_start",
  "process_exit",
  "teardown",
  "platform_error",
]);

export const AgentVmDiagnosticSchema = z.object({
  sequence: z.number().int().nonnegative(),
  code: AgentVmDiagnosticCodeSchema,
  platform: z.enum(["guest", "macos", "windows"]),
  platformCode: z
    .string()
    .regex(/^[A-Za-z0-9_:.-]{1,64}$/u)
    .nullable()
    .default(null),
  createdAt: z.iso.datetime(),
});

export const AgentExecutionStateSchema = z.enum([
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const AgentExecutionSnapshotSchema = z.object({
  id: AgentExecutionIdSchema,
  runId: AgentRunIdSchema,
  sequence: z.number().int().nonnegative(),
  language: AgentLanguageSchema,
  path: AgentWorkspacePathSchema.nullable(),
  source: z.string().max(128_000).nullable(),
  command: z.string().max(128_000).nullable(),
  state: AgentExecutionStateSchema,
  exitCode: z.number().int().min(0).max(255).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  termination: z.enum(["completed", "timeout", "cancelled", "resource_limit", "crash"]).nullable(),
  stdout: z.string().max(1_000_000),
  stderr: z.string().max(1_000_000),
  vmDiagnostics: z.array(AgentVmDiagnosticSchema).max(4_000),
  stdoutBytes: z.number().int().nonnegative().max(1_000_000),
  stderrBytes: z.number().int().nonnegative().max(1_000_000),
  vmDiagnosticsBytes: z
    .number()
    .int()
    .nonnegative()
    .max(256 * 1024),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  vmDiagnosticsTruncated: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export const AgentRunSummarySchema = z.object({
  id: AgentRunIdSchema,
  sessionId: SessionIdSchema,
  jobId: JobIdSchema,
  state: AgentRunStateSchema,
  response: z.string().max(256_000).nullable(),
  error: z.string().max(1_000).nullable(),
  performance: AgentRunPerformanceSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const AgentEventTypeSchema = z.enum([
  "run.started",
  "inference.started",
  "execution.started",
  "execution.completed",
  "assistant.completed",
  "run.failed",
  "run.cancelled",
]);

export const AgentEventSchema = z.object({
  id: AgentEventIdSchema,
  runId: AgentRunIdSchema,
  sequence: z.number().int().nonnegative(),
  type: AgentEventTypeSchema,
  summary: z.string().min(1).max(1_000),
  language: AgentLanguageSchema.nullable().default(null),
  path: AgentWorkspacePathSchema.nullable().default(null),
  source: z.string().max(128_000).nullable().default(null),
  command: z.string().max(128_000).nullable().default(null),
  exitCode: z.number().int().min(0).max(255).nullable().default(null),
  stdout: z.string().max(1_000_000).nullable().default(null),
  stderr: z.string().max(1_000_000).nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  termination: z
    .enum(["completed", "timeout", "cancelled", "resource_limit", "crash"])
    .nullable()
    .default(null),
  createdAt: z.iso.datetime(),
});

export const AgentArtifactSummarySchema = z.object({
  id: AgentArtifactIdSchema,
  runId: AgentRunIdSchema,
  name: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(255),
  byteLength: z
    .number()
    .int()
    .nonnegative()
    .max(64 * 1024 * 1024),
  contentHash: ContentHashSchema,
  createdAt: z.iso.datetime(),
});

export const AgentRunSnapshotSchema = z.object({
  run: AgentRunSummarySchema,
  events: z.array(AgentEventSchema).max(1_000),
  executions: z.array(AgentExecutionSnapshotSchema).max(6).default([]),
  artifacts: z.array(AgentArtifactSummarySchema).max(100),
  thinking: z.string().max(64_000).nullable().default(null),
});

export type AgentLanguage = z.infer<typeof AgentLanguageSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type AgentExecutionResult = z.infer<typeof AgentExecutionResultSchema>;
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;
export type AgentRunPerformance = z.infer<typeof AgentRunPerformanceSchema>;
export type AgentRunState = z.infer<typeof AgentRunStateSchema>;
export type AgentVmDiagnosticCode = z.infer<typeof AgentVmDiagnosticCodeSchema>;
export type AgentVmDiagnostic = z.infer<typeof AgentVmDiagnosticSchema>;
export type AgentExecutionState = z.infer<typeof AgentExecutionStateSchema>;
export type AgentExecutionSnapshot = z.infer<typeof AgentExecutionSnapshotSchema>;
export type AgentRunSummary = z.infer<typeof AgentRunSummarySchema>;
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventDetail = Pick<
  AgentEvent,
  | "language"
  | "path"
  | "source"
  | "command"
  | "exitCode"
  | "stdout"
  | "stderr"
  | "durationMs"
  | "termination"
>;
export type AgentArtifactSummary = z.infer<typeof AgentArtifactSummarySchema>;
export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>;
