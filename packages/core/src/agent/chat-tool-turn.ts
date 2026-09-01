import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatMessage,
  ChatToolCall,
} from "@gardendesk/shared";
import type { ArtifactExecutionEvidence } from "./artifact-results.js";
import {
  emitCompletedTool,
  eventDetail,
  pathOnlyCodeCall,
  recordCompletedExecution,
  retainWorkspaceEvidence,
  validatedEvidenceCall,
} from "./chat-tool-evidence.js";
import type { AgentToolResult, GenericToolRegistry, ToolValidation } from "./generic-tools.js";
import { subagentTitle, toolStartedSummary } from "./tool-summaries.js";

const CODE_TOOLS = new Set(["bash", "python", "node"]);

export interface ChatToolState {
  artifactExecutions: ArtifactExecutionEvidence[];
  executions: AgentExecutionResult[];
  guestExecutionsStarted: number;
  messages: ChatMessage[];
}

interface ToolTurnInput {
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  registry: GenericToolRegistry;
  state: ChatToolState;
}

function beforeExecution(input: ToolTurnInput, call: ChatToolCall, executable: boolean): void {
  const detail = eventDetail(call);
  input.onEvent?.("tool.started", toolStartedSummary(call), detail);
  if (call.name === "task" && executable) {
    input.onEvent?.("subagent.started", subagentTitle(call), detail);
  }
  if (CODE_TOOLS.has(call.name) && !pathOnlyCodeCall(call) && executable) {
    input.onEvent?.("execution.started", "Running code.", detail);
  }
}

function finalizeToolCall(input: ToolTurnInput, call: ChatToolCall, result: AgentToolResult): void {
  retainWorkspaceEvidence(input.state, result);
  recordCompletedExecution(input.state, input.onEvent, call, result);
  input.state.messages.push({
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    result: result.content,
  });
  emitCompletedTool(input.onEvent, call, result);
}

export function initialToolState(messages: ChatMessage[]): ChatToolState {
  return { artifactExecutions: [], executions: [], guestExecutionsStarted: 0, messages };
}

async function executeToolCall(input: ToolTurnInput, call: ChatToolCall): Promise<void> {
  const validation: ToolValidation = input.registry.validate(call.name, call.params);
  const evidenceCall = validatedEvidenceCall(call, validation);
  beforeExecution(input, evidenceCall, validation.status !== "invalid");
  const result =
    validation.status === "invalid"
      ? validation.result
      : await input.registry.execute(call.name, call.params, validation, () => {
          input.state.guestExecutionsStarted += 1;
        });
  finalizeToolCall(input, evidenceCall, result);
}

/** Executes every model-emitted tool call in order, one at a time. */
export async function executeToolCalls(
  input: Omit<ToolTurnInput, "state"> & { state: ChatToolState },
  calls: readonly ChatToolCall[],
): Promise<void> {
  for (const call of calls) {
    await executeToolCall(input, call);
  }
}
