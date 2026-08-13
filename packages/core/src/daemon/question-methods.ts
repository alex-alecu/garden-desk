import {
  AgentQuestionAnswerSchema,
  AgentQuestionIdSchema,
  AgentRunIdSchema,
  type RpcRequest,
} from "@vault/shared";
import type { VaultCore } from "../facade.js";

const AnswerListSchema = AgentQuestionAnswerSchema.array().max(3);

export type QuestionMethodResult =
  | { ok: true; value: { answered: true } | { dismissed: true } }
  | { ok: false; reason: "invalid_request" | "not_found" };

export async function dispatchQuestionMethod(
  core: VaultCore,
  request: RpcRequest,
): Promise<QuestionMethodResult> {
  const runId = AgentRunIdSchema.safeParse(request.params.runId);
  const questionId = AgentQuestionIdSchema.safeParse(request.params.questionId);
  if (!runId.success || !questionId.success) return { ok: false, reason: "invalid_request" };
  if (request.method === "agent.answerQuestion") {
    const answers = AnswerListSchema.safeParse(request.params.answers);
    if (!answers.success) return { ok: false, reason: "invalid_request" };
    const answered = await core.answerQuestion(runId.data, questionId.data, answers.data);
    return answered ? { ok: true, value: { answered: true } } : { ok: false, reason: "not_found" };
  }
  const dismissed = await core.dismissQuestion(runId.data, questionId.data);
  return dismissed ? { ok: true, value: { dismissed: true } } : { ok: false, reason: "not_found" };
}
