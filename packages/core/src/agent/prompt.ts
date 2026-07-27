import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentExecutionResult,
  type InferencePerformance,
  parseXlsxProgress,
} from "@vault/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import { effectiveGenerationInput, type GenerationInput } from "../runtime/inference.js";
import { assembleHistory, type DurableAgentHistory } from "./history.js";
import {
  completedSuccessfully,
  missingOutputLabels,
  requiredOutputLabels,
  verifiedXlsxOutput,
  type XlsxWorkflowPhase,
  xlsxWorkflowPhase,
} from "./output-contract.js";
import { rejectionInstructions } from "./prompt-rejection.js";
import { agentDecisionJsonSchema } from "./prompt-schema.js";
import {
  XLSX_CONTINUE_PHASE,
  XLSX_EXECUTION_INSTRUCTIONS,
  XLSX_REPAIR_PHASE,
  XLSX_WORK_PHASE,
} from "./xlsx-prompt.js";

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
  `Shell executions run command through ${capabilities.shell} from ${capabilities.workspaceMount.path}. Installed tools include ${TOOL_CAPABILITIES}.`,
  "The source field is an array of complete lines with no newline inside an item. The command field is a one-item array containing the complete shell program string; keep every executable and its arguments in that one item.",
  "The response field is an array of at most 100 complete output lines, with no newline inside an item.",
  "Never request networks, credentials, writes to /source, host APIs, or package installation.",
  `Certified guest runtimes and libraries: ${RUNTIME_CAPABILITIES}. Import only modules used by the current execution. Never import pandas. Node.js has built-in modules only.`,
  "Explicit file attachments, when present, are immutable files under /run/attachments.",
  "Inspect the real hierarchy under /source. Use recursive discovery and never assume a flat folder or guess a path.",
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
  lastRejectedProgramReason?: "duplicate" | "invalid" | undefined;
  rejectedDuplicates: number;
}

export function requiresXlsxWorkflow(input: AgentPromptInput): boolean {
  return (
    (input.inputNames ?? []).some((name) => name.toLowerCase().endsWith(".xlsx")) ||
    /\bexcel\b|\.xlsx?\b/iu.test(input.task)
  );
}

interface PromptBounds {
  contextTokens: number;
  requestOverheadTokens: number;
}

function observations(executions: AgentExecutionResult[]) {
  return executions.map((result, index) => ({
    step: index + 1,
    language: result.language,
    path: result.path,
    source: result.source,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    termination: result.termination,
    artifacts: result.artifacts.map((artifact) => artifact.name),
  }));
}

interface PhaseInstructionInput {
  finalResponse: boolean;
  hasCleanUnmarkedOutput: boolean;
  hasCleanLabeledOutput: boolean;
  hasXlsxInput: boolean;
  xlsxPhase: XlsxWorkflowPhase;
}

function phaseInstructions(input: PhaseInstructionInput): readonly string[] {
  if (input.finalResponse) {
    return [
      "No execution capacity remains. Respond now from the observations. State clearly if the task could not be completed or verified.",
    ];
  }
  if (!input.hasXlsxInput) return [];
  if (input.xlsxPhase === "work") return XLSX_WORK_PHASE;
  if (input.xlsxPhase === "repair") {
    if (input.hasCleanLabeledOutput) {
      return [
        "The last execution produced every requested output label, but it did not prove complete XLSX coverage with the three required VAULT_XLSX progress markers.",
        "Execute corrected source now. Reuse or replace the working calculation, then print FILES_DONE as the fully processed XLSX file count, FILES_TOTAL as the discovered XLSX file count, and COMPLETE=1 only when they are equal and every workbook was read.",
        "Do not respond and do not repeat the unchanged source.",
      ];
    }
    if (input.hasCleanUnmarkedOutput) {
      return [
        "The last execution finished cleanly but did not print all three required VAULT_XLSX progress markers.",
        "Repair or replace the program so every normal exit path, including the 75-second checkpoint path, prints FILES_DONE, FILES_TOTAL, and COMPLETE. Print final output labels only when COMPLETE=1.",
        "Do not repeat the unchanged source.",
      ];
    }
    return XLSX_REPAIR_PHASE;
  }
  if (input.xlsxPhase === "continue") return XLSX_CONTINUE_PHASE;
  return [];
}

function hasCleanLabeledOutput(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
  missingLabels: string[],
): boolean {
  const last = executions.at(-1);
  return (
    last !== undefined &&
    completedSuccessfully(last) &&
    last.stderr.trim().length === 0 &&
    requiredLabels.length > 0 &&
    missingLabels.length === 0
  );
}

function hasCleanUnmarkedOutput(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): boolean {
  const last = executions.at(-1);
  return (
    last !== undefined &&
    completedSuccessfully(last) &&
    last.stderr.trim().length === 0 &&
    requiredLabels.length > 0 &&
    parseXlsxProgress(last.stdout) === undefined
  );
}

function serializePrompt(
  current: string,
  history: DurableAgentHistory | undefined,
  bounds: PromptBounds,
): string {
  const usableTokens = Math.max(0, bounds.contextTokens - 4_096 - bounds.requestOverheadTokens);
  const requiredTokens = Math.ceil(current.length / 4);
  if (requiredTokens > usableTokens) throw new Error("agent_context_exhausted");
  const assembled = assembleHistory(history, usableTokens - requiredTokens);
  const serialized = assembled.length === 0 ? current : `${current}\n${assembled}`;
  if (Math.ceil(serialized.length / 4) > usableTokens) throw new Error("agent_context_exhausted");
  return serialized;
}

function continuationInstructions(input: AgentPromptInput): readonly string[] {
  return input.continuation === true
    ? [
        "The user approved continuing the immediately preceding task. Resume its saved checkpoint instead of starting over.",
      ]
    : [];
}

function prompt(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  bounds: PromptBounds,
): string {
  const { executions, rejectedDuplicates } = progress;
  const inputNames = input.inputNames ?? [];
  const artifacts = executions.flatMap((result) =>
    result.artifacts.map((artifact) => artifact.name),
  );
  const hasXlsxInput = requiresXlsxWorkflow(input);
  const requiredLabels = requiredOutputLabels(input.task);
  const successfulExecutionCount = executions.filter(completedSuccessfully).length;
  const completed = executions.filter(completedSuccessfully);
  const missingLabels = missingOutputLabels(completed.at(-1)?.stdout ?? "", requiredLabels);
  const xlsxPhase = xlsxWorkflowPhase(executions, requiredLabels);
  const current = [
    ...EXECUTION_INSTRUCTIONS,
    ...(hasXlsxInput ? XLSX_EXECUTION_INSTRUCTIONS : []),
    ...continuationInstructions(input),
    `Selected input count: ${inputNames.length}.`,
    `Task: ${input.task}`,
    `Completed execution observations: ${JSON.stringify(observations(executions))}`,
    `Successful execution count: ${successfulExecutionCount}.`,
    `Remaining execution capacity: ${Math.max(0, MAX_EXECUTIONS - executions.length)}.`,
    `Rejected duplicate or pathologically repetitive programs: ${rejectedDuplicates}. A rejected program was not executed and does not advance the task. After a rejection, start from a fresh short strategy instead of copying the rejected source.`,
    ...rejectionInstructions(progress),
    `Required output labels: ${JSON.stringify(requiredLabels)}. A result is complete only when stdout contains every label exactly as LABEL=value with no spaces around the equals sign.`,
    `Produced artifact names: ${JSON.stringify(artifacts)}.`,
    "These observations are authoritative. Never repeat completed code or a completed task step.",
    "When an execution failed or produced no useful output, repair its recorded source or command or replace it with a different bounded strategy.",
    "For ordered task steps, completed execution 1 means step 1 is done; the next action must implement step 2.",
    "Choose execute only if a requested step is still missing from the observations.",
    "If every requested execution and artifact is evidenced, you must choose respond now and must not execute again.",
    ...phaseInstructions({
      finalResponse,
      hasCleanUnmarkedOutput: hasCleanUnmarkedOutput(executions, requiredLabels),
      hasCleanLabeledOutput: hasCleanLabeledOutput(executions, requiredLabels, missingLabels),
      hasXlsxInput,
      xlsxPhase,
    }),
  ].join("\n");
  return serializePrompt(current, input.history, bounds);
}

export function generationInput(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse = false,
  contextTokens = 8_192,
): GenerationInput {
  const requiredLabels = requiredOutputLabels(input.task);
  const requiresXlsxExecution =
    !finalResponse &&
    requiresXlsxWorkflow(input) &&
    xlsxWorkflowPhase(progress.executions, requiredLabels) !== "complete";
  const jsonSchema = agentDecisionJsonSchema(input.task, finalResponse, requiresXlsxExecution);
  let requestOverheadTokens = Math.ceil(
    JSON.stringify({ modelId: input.modelId, jsonSchema, contextSize: "auto", maxTokens: 4096 })
      .length / 4,
  );
  const result = effectiveGenerationInput({
    modelId: input.modelId,
    prompt: prompt(input, progress, finalResponse, { contextTokens, requestOverheadTokens }),
    jsonSchema,
    contextSize: "auto",
    maxTokens: 4096,
  });
  const requestTokens = Math.ceil(JSON.stringify(result).length / 4);
  const requestBudget = Math.max(0, contextTokens - 4_096);
  if (requestTokens > requestBudget) {
    requestOverheadTokens += requestTokens - requestBudget;
    result.prompt = effectiveGenerationInput({
      ...result,
      prompt: prompt(input, progress, finalResponse, { contextTokens, requestOverheadTokens }),
    }).prompt;
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
  if (!requiresXlsxWorkflow(input)) return fallback;
  const requiredLabels = requiredOutputLabels(input.task);
  return verifiedXlsxOutput(progress.executions, requiredLabels) ?? fallback;
}
