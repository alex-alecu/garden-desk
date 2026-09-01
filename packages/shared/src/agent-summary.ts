import { z } from "zod";
import { AgentRunIdSchema, SessionIdSchema } from "./ids.js";

export const MAX_ANCHORED_SUMMARY_CHARACTERS = 4_000;

/**
 * The anchored session summary is untrusted model prose. It carries continuity of
 * intent across turns and never carries authoritative values: exact `LABEL=value`
 * facts, artifact names, and completion state stay sourced from durable execution
 * records. Garden Desk Core stores it as bounded plain text so a later turn can read it
 * and a maintainer can inspect it.
 */
export const AgentSessionSummarySchema = z.object({
  sessionId: SessionIdSchema,
  runId: AgentRunIdSchema,
  text: z.string().min(1).max(MAX_ANCHORED_SUMMARY_CHARACTERS),
  coveredMessageId: z.string().min(1),
  coveredMessageCount: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});

export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;
