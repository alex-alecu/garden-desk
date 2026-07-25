import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentExecutionResult,
  type InferencePerformance,
} from "@vault/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import { effectiveGenerationInput, type GenerationInput } from "../runtime/inference.js";
import { assembleHistory, type DurableAgentHistory } from "./history.js";
import { agentDecisionJsonSchema } from "./prompt-schema.js";

export const MAX_EXECUTIONS = 6;
const XLSX_SEARCH_EXAMPLE = [
  "For an XLSX text search, adapt these complete source lines:",
  "from pathlib import Path",
  "import os",
  "from openpyxl import load_workbook",
  "for path in Path(os.environ['VAULT_SOURCE_DIR']).rglob('*'):",
  "    if path.suffix.lower() != '.xlsx': continue",
  "    for sheet in load_workbook(path, data_only=True).worksheets:",
  "        for row in sheet.iter_rows(values_only=True):",
  "            if any('search term' in str(value).lower() for value in row if value is not None):",
  "                print(path.name, sheet.title, row)",
].join("\n");
const XLSX_EXECUTION_INSTRUCTIONS = [
  "For XLSX files, use openpyxl.load_workbook(path, data_only=True) and sheet.iter_rows(values_only=True). Search text as a case-insensitive substring in every nonempty cell, not as equality or in an assumed column; use the discovered headers to select date and amount columns.",
  XLSX_SEARCH_EXAMPLE,
] as const;
const XLSX_INSPECTION_PHASE = [
  "Current required phase: inspect before calculating.",
  "If this is an XLSX text-search task, execute only one short search program now: copy the XLSX search example, replace 'search term' with the requested text, and print every complete matching row with its file and sheet.",
  "Do not add break or stop after the first match. Do not calculate totals, infer headers, normalize numbers, build a transaction list, use try/except, or add comments in this phase.",
] as const;
const XLSX_RESULT_EXAMPLE = [
  "For the verified XLSX result, adapt these complete source lines and replace only the search term and observed amount index:",
  "from pathlib import Path",
  "import os",
  "from openpyxl import load_workbook",
  "count = 0",
  "total = 0.0",
  "for path in Path(os.environ['VAULT_SOURCE_DIR']).rglob('*'):",
  "    if path.suffix.lower() != '.xlsx': continue",
  "    for sheet in load_workbook(path, data_only=True).worksheets:",
  "        for row in sheet.iter_rows(values_only=True):",
  "            if any('search term' in str(value).lower() for value in row if value is not None):",
  "                print(path.name, sheet.title, row)",
  "                count += 1",
  "                total += float(row[AMOUNT_INDEX])",
  "print('Match count:', count)",
  "print('Total:', total)",
].join("\n");
const XLSX_RESULT_PHASE = [
  "Current required phase: calculate and verify from the inspected structure before responding.",
  "Execute one short program that repeats the search and prints every requested summary row, the match count, and any requested total.",
  "Use plain comma-separated print calls. Do not build lists or dictionaries, format Markdown, use f-strings, sort, add comments, or close workbooks.",
  "Select indexes from the observed row structure and calculate from workbook values. Do not copy values into source or normalize values that are already numeric.",
  XLSX_RESULT_EXAMPLE,
] as const;
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
  "After a failure, use the recorded path, source or command, exit status, stdout, and stderr to make the smallest repair and verify it.",
  "Always return final responses as concise GitHub Flavored Markdown, including single-line answers. Never return raw HTML, images, or Markdown links.",
] as const;

export interface AgentPromptInput {
  task: string;
  modelId: string;
  inputNames?: string[];
  history?: DurableAgentHistory;
}

export interface AgentProgress {
  executions: AgentExecutionResult[];
  inference: InferencePerformance;
  rejectedDuplicates: number;
}

function requiresXlsxWorkflow(input: AgentPromptInput): boolean {
  return (
    (input.inputNames ?? []).some((name) => name.toLowerCase().endsWith(".xlsx")) ||
    /\bexcel\b|\.xlsx?\b/iu.test(input.task)
  );
}

interface PromptBounds {
  contextTokens: number;
  requestOverheadTokens: number;
}

export function hasUsefulResult(result: AgentExecutionResult): boolean {
  return (
    result.exitCode === 0 &&
    result.termination === "completed" &&
    (result.stdout.trim().length > 0 || result.artifacts.length > 0)
  );
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

function phaseInstructions(
  finalResponse: boolean,
  hasXlsxInput: boolean,
  usefulExecutionCount: number,
): readonly string[] {
  if (finalResponse) {
    return [
      "No execution capacity remains. Respond now from the observations. State clearly if the task could not be completed or verified.",
    ];
  }
  if (!hasXlsxInput) return [];
  if (usefulExecutionCount === 0) return XLSX_INSPECTION_PHASE;
  if (usefulExecutionCount === 1) return XLSX_RESULT_PHASE;
  return [];
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
  const usefulExecutionCount = executions.filter(hasUsefulResult).length;
  const current = [
    ...EXECUTION_INSTRUCTIONS,
    ...(hasXlsxInput ? XLSX_EXECUTION_INSTRUCTIONS : []),
    `Selected input count: ${inputNames.length}.`,
    `Task: ${input.task}`,
    `Completed execution observations: ${JSON.stringify(observations(executions))}`,
    `Successful execution count: ${executions.filter((item) => item.exitCode === 0 && item.termination === "completed").length}.`,
    `Remaining execution capacity: ${Math.max(0, MAX_EXECUTIONS - executions.length)}.`,
    `Rejected exact duplicate programs: ${rejectedDuplicates}. A rejected program was not executed and does not advance the task. After a rejection, repair the failed step or implement the next missing task step with different code.`,
    `Produced artifact names: ${JSON.stringify(artifacts)}.`,
    "These observations are authoritative. Never repeat completed code or a completed task step.",
    "When an execution failed or produced no useful output, repair its recorded source or command at the same path instead of starting over.",
    "For ordered task steps, completed execution 1 means step 1 is done; the next action must implement step 2.",
    "Choose execute only if a requested step is still missing from the observations.",
    "If every requested execution and artifact is evidenced, you must choose respond now and must not execute again.",
    ...phaseInstructions(finalResponse, hasXlsxInput, usefulExecutionCount),
  ].join("\n");
  const usableTokens = Math.max(0, bounds.contextTokens - 4_096 - bounds.requestOverheadTokens);
  const requiredTokens = Math.ceil(current.length / 4);
  if (requiredTokens > usableTokens) throw new Error("agent_context_exhausted");
  const history = assembleHistory(input.history, usableTokens - requiredTokens);
  const serialized = history.length === 0 ? current : `${current}\n${history}`;
  if (Math.ceil(serialized.length / 4) > usableTokens) throw new Error("agent_context_exhausted");
  return serialized;
}

export function generationInput(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse = false,
  contextTokens = 8_192,
): GenerationInput {
  const requiresXlsxExecution =
    !finalResponse &&
    requiresXlsxWorkflow(input) &&
    progress.executions.filter(hasUsefulResult).length < 2;
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
