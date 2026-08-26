import { resolve } from "node:path";
import type { ChatMessage } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { withCurrentTimeContext } from "./chat-current-time.js";
import { initialChatMessages } from "./chat-initial-messages.js";
import type { ChatAgentInput } from "./chat-loop-input.js";
import { GenericToolRegistry } from "./generic-tools.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";

const MINIMUM_PROMPT_INPUT_TOKENS = 4_096;
const PROMPT_INPUT_HEADROOM_TOKENS = 3_900;
const PROFESSIONAL_PROMPT_TOKEN_LIMIT = 4_000;
const PROFESSIONAL_FORMAT_SKILLS = ["word-documents", "pdf-documents", "xlsx-workbooks"] as const;
const PROFESSIONAL_DOMAIN_SKILLS = [
  "budget-variance-review",
  "finance-document-review",
  "financial-records-reconciliation",
  "invoice-expense-review",
  "legal-document-comparison",
  "legal-document-review",
  "legal-due-diligence-review",
  "legal-matter-chronology",
  "medical-billing-document-review",
  "medical-record-review",
  "medical-record-timeline",
  "prior-authorization-document-review",
] as const;
const FORMAT_BODY_TOKEN_LIMITS = {
  "word-documents": 800,
  "pdf-documents": 550,
  "xlsx-workbooks": 800,
  "review-report": 400,
} as const;

const FORMAT_NEUTRAL_TASK =
  "Inspect selected folder and complete the requested local work from direct source evidence. Use only approved guest tools, keep the task boundary, and return a concise verified outcome. Do not assume facts outside the source. Check each needed result before the final response. Keep generated material in the workspace only when the task needs it. Report important limits, then stop after the required evidence is complete. Take the smallest useful next step and keep every action inside the approved local scope.";

const unusedExecutor: AgentExecutor = {
  async execute() {
    throw new Error("unused_prompt_budget_executor");
  },
};

function estimatedTokens(...texts: readonly string[]): number {
  return Math.ceil(texts.join("\n").length / 4);
}

function promptInput(library: MarkdownDefinitionLibrary): ChatAgentInput {
  return {
    agent: library.agent("primary"),
    contextTokens: "auto",
    executor: unusedExecutor,
    modelId: "prompt-budget-test",
    skills: {
      metadata: () => [...library.skills],
      read: (name) => library.skill(name).body,
    },
    systemPrompt: (name) => library.system(name),
    task: FORMAT_NEUTRAL_TASK,
  };
}

function assembledTokens(
  messages: readonly ChatMessage[],
  tools: ReturnType<GenericToolRegistry["definitions"]>,
): number {
  return estimatedTokens(JSON.stringify(messages), JSON.stringify({ tools }));
}

function messagesAfterWordLoad(
  messages: readonly ChatMessage[],
  library: MarkdownDefinitionLibrary,
): ChatMessage[] {
  const callId = "word-documents-load";
  return [
    ...messages,
    {
      role: "assistant",
      text: "",
      toolCalls: [{ id: callId, name: "skill", params: { name: "word-documents" } }],
    },
    {
      role: "tool",
      toolCallId: callId,
      name: "skill",
      result: library.skill("word-documents").body,
    },
  ];
}

function messagesAfterSkillLoads(
  messages: readonly ChatMessage[],
  library: MarkdownDefinitionLibrary,
  names: readonly string[],
): ChatMessage[] {
  const loaded = [...messages];
  for (const [index, name] of names.entries()) {
    const callId = `skill-load-${index}`;
    loaded.push(
      { role: "assistant", text: "", toolCalls: [{ id: callId, name: "skill", params: { name } }] },
      { role: "tool", toolCallId: callId, name: "skill", result: library.skill(name).body },
    );
  }
  return loaded;
}

function expectWord(library: MarkdownDefinitionLibrary): void {
  const skill = library.skill("word-documents");
  expect(skill.description).toContain("Before any legacy .doc access, load this skill");
  expect(skill.description).toContain("never use generic read or cat for binary DOC");
  expect(skill.body).toContain("Load this skill before any DOC access");
  expect(skill.body).toContain("never use generic `read` or `cat`");
  expect(skill.body).toContain("use this complete Python pattern");
  const programs = [...skill.body.matchAll(/```python\n([\s\S]*?)```/g)].map((match) => match[1]);
  expect(programs).toHaveLength(1);
  const [legacy] = programs;
  expect(legacy).toMatch(/^source=/mu);
  expect(legacy).toMatch(/^result=subprocess\.run\(/mu);
  expect(legacy).toMatch(/^text=result\.stdout\.decode\(/mu);
  expect(legacy).toMatch(/^if result\.returncode != 0:/mu);
  expect(legacy).toMatch(/^if not text\.strip\(\):/mu);
  expect(legacy).toContain(
    'source=next(iter([*Path("/source").glob("*.doc"),*Path("/run/attachments").glob("*.doc")]))',
  );
  expect(legacy).toContain('Path("/run/attachments").glob("*.doc")');
  expect(legacy).toContain('["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0", str(source)]');
  expect(legacy).toContain('env={**os.environ, "LANG": "C", "LC_ALL": "C", "LC_CTYPE": "C"}');
  expect(legacy).toContain("capture_output=True");
  expect(legacy).toContain("check=False");
  expect(legacy).toContain("timeout=5");
  expect(legacy).not.toContain("text=True");
  expect(legacy).toContain('if result.returncode != 0: raise RuntimeError("read failed")');
  expect(legacy).toContain('text=result.stdout.decode("utf-8", errors="strict")');
  expect(legacy).toContain('if not text.strip(): raise RuntimeError("No text")');
  expect(legacy).not.toContain("try:");
  expect(legacy).not.toContain("except");
  expect(legacy).toContain("print(text)");
  expect(skill.body).toContain("Run this block exactly.");
  expect(skill.body).toContain(
    "Keep `source`, `result`, `text`, and both `if` statements at column zero.",
  );
  expect(skill.body).toContain("Do not add a path check, path fallback, wrapper, function");
  expect(skill.body).toContain("`try`/`except`, `text=True`, decode change, or failure output.");
  expect(skill.body).toContain("Never create/edit `.doc`");
  expect(() => library.skill("docx-documents")).toThrow("Unknown skill");
}

function expectPdf(library: MarkdownDefinitionLibrary): void {
  const skill = library.skill("pdf-documents");
  const programs = [...skill.body.matchAll(/```python\n([\s\S]*?)```/g)].map((match) => match[1]);
  expect(programs).toHaveLength(1);
  const [inspection] = programs;
  expect(skill.body).toContain("Without PDF output: inspect/reopen with `pypdf` only.");
  expect(skill.body).toContain(
    "In one `pypdf` program, derive requested labels directly from the actual source PDF.",
  );
  expect(skill.body).toContain(
    "Do not assume `/source/values.txt`, `COUNT`, `TOTAL`, or `report.pdf`.",
  );
  expect(skill.body).toContain(
    "Use the task-specified output name. Put each derived result in visible ReportLab PDF text as exact `LABEL=value`; keep the requested label unchanged.",
  );
  expect(skill.body).toContain("ReportLab Platypus: headings/page breaks/margins/fitting tables.");
  expect(skill.body).toContain(
    "Reopen/verify text, page count/order, rotation, size, metadata, and every requested pair before completion.",
  );
  expect(inspection).toContain("from pypdf import PdfReader");
  expect(inspection).toContain(
    'for source in sorted(path for path in Path("/source").rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"):',
  );
  expect(inspection).toContain("PdfReader(source)");
  expect(inspection).not.toContain("next(");
  expect(inspection).not.toContain("report.pdf");
  expect(inspection).not.toContain("values.txt");
  expect(inspection).not.toContain("reportlab");
  expect(skill.body).toContain("no `try`, exception wrapper, or trailing brace");
}

function expectXlsx(library: MarkdownDefinitionLibrary): void {
  const skill = library.skill("xlsx-workbooks");
  for (const text of [
    "reset_dimensions()",
    "recursively find case-insensitive",
    "load_workbook(path, read_only=True, data_only=True)",
    "Else reusable:",
    "sorted relative corpus",
    "`completed`",
    'checkpoint=Path("/workspace/steps/checkpoint.json")',
    'temporary=Path("/workspace/steps/checkpoint.json.tmp")',
    "os.replace(temporary,checkpoint)",
    "SHA-256 identity/rows/counts/totals",
    "replace/recompute contribution",
    "Resume: remove missing/changed state",
    "skip same identity",
    "no double count",
    "deadline=time.monotonic()+75",
    "before next file",
    "`SystemExit(0)`",
    "successful continuation exit reports concise progress",
    "Normal library stderr: not failure; exit status/reopened output control success.",
    "Only when `completed` equals rediscovered current corpus: create/reopen final workbook",
    "checkpoint.unlink()",
  ]) {
    expect(skill.body).toContain(text);
  }
  expect(skill.body).toContain("source+`steps/...` saves `/workspace/steps`");
  expect(skill.body).toContain("repair as primary; rerun path only");
  expect(skill.body).not.toContain("Else reusable program.");
}

function expectReviewReport(library: MarkdownDefinitionLibrary): void {
  const skill = library.skill("review-report");
  expect(skill.body).toContain("File without format: DOCX");
  expect(skill.body).toContain("Mixed: complete/verify/save each state separately");
  expect(skill.body).toContain("Saved: continuation only");
  expect(skill.body).toContain("Final: reread/rederive source facts, compare saved state");
  expect(skill.body).toContain("create/reopen/verify outputs, report completion");
}

function expectBudgets(library: MarkdownDefinitionLibrary): void {
  for (const [name, limit] of Object.entries(FORMAT_BODY_TOKEN_LIMITS)) {
    expect(estimatedTokens(library.skill(name).body)).toBeLessThanOrEqual(limit);
  }
  expect(FORMAT_NEUTRAL_TASK).toHaveLength(512);
  const input = promptInput(library);
  const registry = new GenericToolRegistry({ executor: unusedExecutor, skills: input.skills });
  const initial = withCurrentTimeContext(initialChatMessages(input));
  const beforeLoad = assembledTokens(initial, registry.definitions(input.agent.tools));
  const afterLoad = assembledTokens(
    messagesAfterWordLoad(initial, library),
    registry.definitions(input.agent.tools, new Set(["word-documents"])),
  );

  expect(beforeLoad).toBeLessThanOrEqual(MINIMUM_PROMPT_INPUT_TOKENS);
  expect(afterLoad).toBeLessThanOrEqual(MINIMUM_PROMPT_INPUT_TOKENS);
  expect(afterLoad).toBeLessThanOrEqual(PROMPT_INPUT_HEADROOM_TOKENS);
}

function expectProfessionalLoadBudgets(library: MarkdownDefinitionLibrary): void {
  const input = promptInput(library);
  const registry = new GenericToolRegistry({ executor: unusedExecutor, skills: input.skills });
  const initial = withCurrentTimeContext(initialChatMessages(input));
  const estimates = PROFESSIONAL_FORMAT_SKILLS.flatMap((format) =>
    PROFESSIONAL_DOMAIN_SKILLS.map((domain) => {
      const names = [format, "document-review", domain, "review-report"];
      const messages = messagesAfterSkillLoads(initial, library, names);
      return {
        path: `${format} + ${domain}`,
        tokens: assembledTokens(messages, registry.definitions(input.agent.tools, new Set(names))),
      };
    }),
  );
  expect(estimates).toHaveLength(36);
  for (const estimate of estimates) {
    expect(estimate.tokens, estimate.path).toBeLessThanOrEqual(PROFESSIONAL_PROMPT_TOKEN_LIMIT);
  }
  expect(Math.max(...estimates.map(({ tokens }) => tokens))).toBeLessThanOrEqual(
    PROFESSIONAL_PROMPT_TOKEN_LIMIT,
  );
}

describe("format skill prompt contracts", () => {
  it("keeps the selected authored prompt within the certified minimum context", () => {
    const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
    expectWord(library);
    expectPdf(library);
    expectXlsx(library);
    expectReviewReport(library);
    expectBudgets(library);
    expectProfessionalLoadBudgets(library);
  });
});
