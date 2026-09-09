import type { AgentRunResult } from "@gardendesk/shared";
import type { ChatAgentInput } from "../agent/chat-loop-input.js";
import type { InferenceService } from "../runtime/inference.js";
import { runDocumentReview } from "./document-review.js";
import type { CommandInvocation } from "./library.js";

export async function runCommand(
  command: CommandInvocation,
  input: ChatAgentInput,
  chat: InferenceService["chat"],
  runAgent: (input: ChatAgentInput) => Promise<AgentRunResult>,
): Promise<AgentRunResult> {
  if (command.workflow === "document-review") return runDocumentReview(command, input, chat);
  const task = command.body.includes("$ARGUMENTS")
    ? command.body.replaceAll("$ARGUMENTS", () => command.arguments)
    : `${command.body}\n\n${command.arguments}`;
  return runAgent({ ...input, task });
}
