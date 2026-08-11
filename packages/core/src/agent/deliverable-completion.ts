import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { artifactCandidateNames, requestedFactLabels } from "./artifact-declarations.js";

const CREATION_REQUEST =
  /\b(?:create|generate|write|make|build|produce|save|convert|export|render|output)\b/iu;
const PROMISED_WORK =
  /\b(?:i\s+will|i'?ll|i\s+am\s+going\s+to|let\s+me|i\s+can\s+(?:create|generate|write|produce|help)|shall\s+i|would\s+you\s+like|please\s+let\s+me\s+know|to\s+get\s+started)\b/iu;

/**
 * A task asks for a produced file when an active skill declares that it creates
 * deliverables and the task uses a creation verb. Format vocabulary stays in
 * skill metadata; this module never names a document format.
 */
export function requestsDeliverable(task: string, deliverableSkillActive: boolean): boolean {
  return deliverableSkillActive && CREATION_REQUEST.test(task);
}

function producedDeliverable(executions: readonly AgentExecutionResult[], task: string): boolean {
  return artifactCandidateNames(executions, requestedFactLabels(task)).length > 0;
}

/**
 * Detects a response that only announces or offers future work. The model must
 * not end a deliverable task with a promise, a question, or an intent statement
 * when nothing was produced.
 */
export function isPromiseOnlyResponse(response: string): boolean {
  return PROMISED_WORK.test(response) || response.trim().endsWith("?");
}

export interface DeliverableCompletionInput {
  decision: Extract<AgentDecision, { action: "respond" }>;
  deliverableSkillActive: boolean;
  executions: readonly AgentExecutionResult[];
  task: string;
}

/**
 * Returns true when a final response must be refused because the task requested
 * a produced file, nothing was executed, and no deliverable exists. Accepting
 * such a response would report success for work that never happened.
 */
export function rejectsUnbackedResponse(input: DeliverableCompletionInput): boolean {
  const { decision, deliverableSkillActive, executions, task } = input;
  if (!requestsDeliverable(task, deliverableSkillActive)) return false;
  if (decision.artifacts !== undefined && decision.artifacts.length > 0) return false;
  if (producedDeliverable(executions, task)) return false;
  if (executions.length > 0) return false;
  return isPromiseOnlyResponse(decision.response);
}
