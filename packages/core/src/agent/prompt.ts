import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentExecutionResult,
  type InferencePerformance,
  MAX_GENERATION_TOKENS,
} from "@vault/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import { effectiveGenerationInput, type GenerationInput } from "../runtime/inference.js";
import type { DurableAgentHistory } from "./history.js";
import {
  completedSuccessfully,
  missingOutputLabels,
  requiredOutputLabels,
  verifiedXlsxOutput,
  xlsxWorkflowPhase,
} from "./output-contract.js";
import {
  generationBudget,
  generationRecoveryInstructions,
  generationTokenReserve,
  type PromptBounds,
  serializePrompt,
  usablePromptTokens,
} from "./prompt-budget.js";
import {
  attachedPdfAlreadyExtracted,
  continuationInstructions,
  selectedInputInstructions,
} from "./prompt-inputs.js";
import { observationStreamCharacters, observations } from "./prompt-observations.js";
import { rejectionInstructions } from "./prompt-rejection.js";
import {
  agentDecisionJsonSchema,
  GENERATION_LIMIT_RECOVERY_SOURCE_LINES,
  SHELL_COMMAND_CHARACTER_LIMIT,
} from "./prompt-schema.js";
import {
  requiresXlsxWorkflow,
  xlsxPhaseInstructions,
  xlsxProcessingExecutions,
} from "./prompt-xlsx.js";
import { XLSX_EXECUTION_INSTRUCTIONS } from "./xlsx-prompt.js";

export { requiresXlsxWorkflow } from "./prompt-xlsx.js";

export const MAX_EXECUTIONS = 6;
const RUNTIME_CAPABILITIES = Object.entries(capabilities.runtimes)
  .map(([name, version]) => `${name} ${version}`)
  .join(", ");
const TOOL_CAPABILITIES = ["sh", "find", "grep", "sed", "awk", "diff", "patch", "tar"]
  .filter((name) => capabilities.executables.some((path) => path.endsWith(`/${name}`)))
  .join(", ");
const EXECUTION_INSTRUCTIONS = [
  "You are an offline development agent.",
  "Choose one action. Execute only when inspection, editing, or verification is needed.",
  "When the task names Python or Node executions, every execution action must use that language, including inspection; do not use shell. Follow an explicit execution count exactly.",
  "The selected folder is mounted live and read-only at /source with its original hierarchy. Host changes become visible immediately; writes must fail.",
  "Your persistent writable work tree is /workspace. It survives later steps, follow-ups, VM eviction, and application restart.",
  "Temporary files may use the bounded ephemeral /run/user directory through TMPDIR. Do not write elsewhere in the guest.",
  "Python and Node executions use a safe /workspace-relative path and complete source. Reuse the same path when repairing a failed program.",
  "When path is omitted, Vault Desk assigns steps/NNNN.py or steps/NNNN.mjs. Never use absolute paths, backslashes, empty components, dot components, or parent traversal.",
  `Shell executions run command through ${capabilities.shell} from ${capabilities.workspaceMount.path}. Installed tools include ${TOOL_CAPABILITIES}. Keep a shell command shorter than ${SHELL_COMMAND_CHARACTER_LIMIT.toLocaleString("en-US")} characters; a command that reaches that boundary is treated as potentially truncated and is not executed.`,
  "Never embed a Python or Node program in a shell command. Choose the matching Python or Node source action so Vault Desk writes the source to a workspace file and executes it.",
  `Each model turn can generate at most ${MAX_GENERATION_TOKENS.toLocaleString("en-US")} tokens. If a complete program cannot fit, use multiple Python or Node source actions that create or patch one bounded part of a file under /workspace, then execute the completed file with a short command.`,
  "The source field is an array of complete lines with no newline inside an item. The command field is a one-item array containing the complete shell program string; keep every executable and its arguments in that one item and keep it below the stated 4,096-character boundary.",
  "The response field is an array of at most 100 complete output lines, with no newline inside an item.",
  "Never request networks, credentials, writes to /source, host APIs, or package installation.",
  `Certified guest runtimes and libraries: ${RUNTIME_CAPABILITIES}. Import only modules used by the current execution. Never import pandas. Node.js has built-in modules only.`,
  "Node source is written to an .mjs ES module. Use ESM import syntax; require is unavailable.",
  "Source contains only the executable program. Never include tool-call, channel, thought, or structured-response delimiter text in source.",
  "Explicit file attachments, when present, are immutable files under /run/attachments.",
  "Inspect the real hierarchy under /source. Use recursive discovery and never assume a flat folder or guess a path.",
  "When discovering files by extension, match the extension case-insensitively; with find, use -iname instead of -name.",
  "After a failure, use the recorded path, source or command, exit status, stdout, and stderr to repair or replace the approach. Every repair must be a short complete runnable program, never a truncated fragment or a copy of corrupted or repetitive source.",
  "Always return final responses as concise GitHub Flavored Markdown, including single-line answers. Never return raw HTML, images, or Markdown links.",
] as const;

export interface AgentPromptInput {
  task: string;
  modelId: string;
  inputNames?: string[];
  history?: DurableAgentHistory;
  continuation?: boolean;
}

export interface AgentProgress {
  executions: AgentExecutionResult[];
  inference: InferencePerformance;
  lastRejectedProgramReason?: "duplicate" | "invalid" | "shell_limit" | "shell_source" | undefined;
  rejectedDuplicates: number;
}

function needsShellSourceRepair(progress: AgentProgress): boolean {
  if (
    progress.lastRejectedProgramReason === "shell_limit" ||
    progress.lastRejectedProgramReason === "shell_source"
  )
    return true;
  const latest = progress.executions.at(-1);
  return (
    latest?.language === "shell" &&
    latest.exitCode !== 0 &&
    /unterminated quoted string/iu.test(latest.stderr)
  );
}

function shellSourceRepairInstructions(progress: AgentProgress): readonly string[] {
  const latest = progress.executions.at(-1);
  if (
    latest?.language !== "shell" ||
    latest.exitCode === 0 ||
    !/unterminated quoted string/iu.test(latest.stderr)
  )
    return [];
  return [
    "The last shell command failed because it contained an unterminated quoted string.",
    "Do not repair it as another shell command. Submit a Python or Node source action instead; Vault Desk writes that source to a workspace file and executes it.",
  ];
}

export type GenerationRecovery = "generation_limit" | undefined;
interface PromptOptions extends PromptBounds {
  recovery: GenerationRecovery;
}
interface GenerationInputOptions {
  contextTokens?: number;
  recovery?: GenerationRecovery;
}

function prompt(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  options: PromptOptions,
): string {
  const { executions, rejectedDuplicates } = progress;
  const inputNames = input.inputNames ?? [];
  const artifacts = executions.flatMap((result) =>
    result.artifacts.map((artifact) => artifact.name),
  );
  const hasXlsxInput = requiresXlsxWorkflow(input, executions);
  const requiredLabels = requiredOutputLabels(input.task);
  const successfulExecutionCount = executions.filter(completedSuccessfully).length;
  const completed = executions.filter(completedSuccessfully);
  const missingLabels = missingOutputLabels(completed.at(-1)?.stdout ?? "", requiredLabels);
  const current = [
    ...EXECUTION_INSTRUCTIONS,
    ...(hasXlsxInput ? XLSX_EXECUTION_INSTRUCTIONS : []),
    ...generationRecoveryInstructions(options.recovery, finalResponse),
    ...continuationInstructions(input.continuation),
    ...selectedInputInstructions(inputNames),
    `Task: ${input.task}`,
    `Completed execution observations: ${JSON.stringify(observations(executions, observationStreamCharacters(usablePromptTokens(options))))}`,
    `Successful execution count: ${successfulExecutionCount}.`,
    `Remaining execution capacity: ${Math.max(0, MAX_EXECUTIONS - executions.length)}.`,
    `Rejected duplicate or pathologically repetitive programs: ${rejectedDuplicates}. A rejected program was not executed and does not advance the task. After a rejection, start from a fresh short strategy instead of copying the rejected source.`,
    ...rejectionInstructions(progress),
    ...shellSourceRepairInstructions(progress),
    `Required output labels: ${JSON.stringify(requiredLabels)}. A result is complete only when stdout contains every label exactly as LABEL=value with no spaces around the equals sign.`,
    `Produced artifact names: ${JSON.stringify(artifacts)}.`,
    "These observations are authoritative. Never repeat completed code or a completed task step.",
    "When an execution failed or produced no useful output, repair its recorded source or command or replace it with a different bounded strategy.",
    "For ordered task steps, completed execution 1 means step 1 is done; the next action must implement step 2.",
    "Choose execute only if a requested step is still missing from the observations.",
    "If every requested execution and artifact is evidenced, you must choose respond now and must not execute again.",
    ...xlsxPhaseInstructions({
      finalResponse,
      hasXlsxInput,
      executions,
      requiredLabels,
      missingLabels,
    }),
  ].join("\n");
  return serializePrompt(current, input.history, options);
}

function generationSchema(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  recovery: GenerationRecovery,
) {
  const requiredLabels = requiredOutputLabels(input.task);
  const requiresXlsxExecution =
    !finalResponse &&
    requiresXlsxWorkflow(input, progress.executions) &&
    xlsxWorkflowPhase(xlsxProcessingExecutions(progress.executions), requiredLabels) !== "complete";
  const inputNames = input.inputNames ?? [];
  const requiresAttachedPdfExecution =
    !finalResponse &&
    progress.executions.length === 0 &&
    inputNames.some((name) => name.toLocaleLowerCase("en-US").endsWith(".pdf")) &&
    !attachedPdfAlreadyExtracted(inputNames, input.history);
  const generationLimitRecovery = recovery === "generation_limit" && !finalResponse;
  return agentDecisionJsonSchema({
    task: input.task,
    finalResponse,
    requiresSourceExecution:
      requiresXlsxExecution ||
      requiresAttachedPdfExecution ||
      needsShellSourceRepair(progress) ||
      generationLimitRecovery,
    ...(generationLimitRecovery ? { sourceLineLimit: GENERATION_LIMIT_RECOVERY_SOURCE_LINES } : {}),
    ...(requiresAttachedPdfExecution ? { requiredLanguage: "python" as const } : {}),
  });
}

interface BuildGenerationInput {
  input: AgentPromptInput;
  progress: AgentProgress;
  finalResponse: boolean;
  options: PromptOptions;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

function buildGenerationInput(build: BuildGenerationInput): GenerationInput {
  return effectiveGenerationInput({
    modelId: build.input.modelId,
    prompt: prompt(build.input, build.progress, build.finalResponse, build.options),
    jsonSchema: build.jsonSchema,
    contextSize: "auto",
    maxTokens: build.maxTokens,
  });
}

export function generationInput(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse = false,
  options: GenerationInputOptions = {},
): GenerationInput {
  const contextTokens = options.contextTokens ?? 8_192;
  const recovery = options.recovery;
  const jsonSchema = generationSchema(input, progress, finalResponse, recovery);
  const maxTokens = generationBudget(input, progress, finalResponse, recovery);
  const generationTokens = generationTokenReserve(contextTokens, maxTokens);
  let requestOverheadTokens = Math.ceil(
    JSON.stringify({
      modelId: input.modelId,
      jsonSchema,
      contextSize: "auto",
      maxTokens,
    }).length / 4,
  );
  const build = (overhead: number) =>
    buildGenerationInput({
      input,
      progress,
      finalResponse,
      options: { contextTokens, generationTokens, requestOverheadTokens: overhead, recovery },
      jsonSchema,
      maxTokens,
    });
  const result = build(requestOverheadTokens);
  const requestBudget = Math.max(0, contextTokens - generationTokens);
  const requestTokens = Math.ceil(JSON.stringify(result).length / 4);
  if (requestTokens > requestBudget) {
    requestOverheadTokens += requestTokens - requestBudget;
    result.prompt = build(requestOverheadTokens).prompt;
  }
  if (Math.ceil(JSON.stringify(result).length / 4) > requestBudget) {
    throw new Error("agent_context_exhausted");
  }
  return result;
}

export function parseDecision(value: unknown): AgentDecision {
  if (typeof value !== "object" || value === null) return AgentDecisionSchema.parse(value);
  const decision = value as Record<string, unknown>;
  if (decision.action === "execute" && Array.isArray(decision.source)) {
    return AgentDecisionSchema.parse({ ...decision, source: decision.source.join("\n") });
  }
  if (decision.action === "execute" && Array.isArray(decision.command)) {
    return AgentDecisionSchema.parse({ ...decision, command: decision.command.join("\n") });
  }
  if (decision.action === "respond" && Array.isArray(decision.response)) {
    return AgentDecisionSchema.parse({ ...decision, response: decision.response.join("\n") });
  }
  return AgentDecisionSchema.parse(value);
}

export function executionBackedResponse(
  input: AgentPromptInput,
  progress: AgentProgress,
  fallback: string,
): string {
  if (!requiresXlsxWorkflow(input, progress.executions)) return fallback;
  const requiredLabels = requiredOutputLabels(input.task);
  return verifiedXlsxOutput(progress.executions, requiredLabels) ?? fallback;
}
