import type { AgentQuestionRequest, AgentRunSummary } from "@vault/shared";
import type { DesktopApi } from "../api.js";
import { QuestionPrompt } from "./question-prompt.js";

interface PendingQuestionProps {
  api: DesktopApi;
  request: AgentQuestionRequest;
  run: AgentRunSummary | undefined;
  setError(message: string): void;
}

export function PendingQuestion({ api, request, run, setError }: PendingQuestionProps) {
  return (
    <QuestionPrompt
      key={request.id}
      onAnswer={(questionId, answers) => {
        if (run === undefined) return;
        void api
          .answerQuestion(run.id, questionId, answers)
          .catch(() => setError("Your answer could not be sent."));
      }}
      onDismiss={(questionId) => {
        if (run === undefined) return;
        void api
          .dismissQuestion(run.id, questionId)
          .catch(() => setError("The question could not be dismissed."));
      }}
      onStop={() => {
        if (run === undefined) return;
        void api.cancelAgent(run.jobId).catch(() => setError("The task could not be cancelled."));
      }}
      request={request}
      stopping={run?.state === "cancelled"}
    />
  );
}
