import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PromptLibrary, parsePromptSkill } from "./prompt-library.js";

function library(): PromptLibrary {
  return new PromptLibrary(resolve(process.cwd(), "prompts"));
}

describe("PromptLibrary discovery", () => {
  it("loads Agent Skills-compatible metadata from the root prompt directory", () => {
    expect(library().skills.map(({ name }) => name)).toEqual([
      "docx-documents",
      "pdf-documents",
      "terminal-commands",
      "xlsx-workbooks",
    ]);
  });

  it("loads terminal guidance for a source-tree location task without command-specific routing", () => {
    const prompts = library();
    const input = {
      task: "Tell me where the system prompt is in this source code folder.",
      inputNames: [],
    };
    const body = prompts.activeSkills(input, {
      shell_command_character_limit: "4,096",
      shell_path: "/bin/sh",
      tool_capabilities: "find, grep",
      workspace_path: "/workspace",
    });
    expect([...prompts.activeSkillNames(input)]).toEqual(["terminal-commands"]);
    expect(body).toContain("Confirm every executable, option, redirection, and pipeline stage");
    expect(body).toContain("empty output identifies no candidate");
    expect(body).toContain(
      "Do not restrict initial source discovery to a guessed extension allowlist",
    );
    expect(body).toContain("never gate candidates with `filename.endswith((...))`");
    expect(body).toContain("switch to one short Python or Node source action");
    expect(body).toContain("never invent a conventional path");
  });
});

describe("PromptLibrary skill selection", () => {
  it("uses task and attachment evidence to disclose format skills", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({
        task: "Summarize the attachment.",
        inputNames: ["REPORT.PDF"],
      }),
    ]).toEqual(["pdf-documents"]);
    expect([
      ...prompts.activeSkillNames({
        task: "Total every salary in the workbooks.",
        inputNames: [],
      }),
    ]).toEqual(["xlsx-workbooks"]);
  });

  it("keeps unrelated skill bodies out of direct-answer prompts", () => {
    expect([
      ...library().activeSkillNames({
        task: "Explain what offline means.",
        inputNames: [],
      }),
    ]).toEqual([]);
  });

  it("allows typed workflows to require a skill without routing on untrusted output", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({
        task: "Calculate monthly totals.",
        inputNames: [],
        requestedSkillNames: ["xlsx-workbooks"],
      }),
    ]).toEqual(["xlsx-workbooks"]);
  });

  it("keeps template-shaped runtime data literal", () => {
    expect(
      library().state("observation-elision", { omitted_characters: "{{untrusted_value}}" }),
    ).toContain("{{untrusted_value}} characters omitted");
  });

  it("rejects mismatched skill directory metadata", () => {
    expect(() =>
      parsePromptSkill(
        "terminal-commands",
        "---\nname: other-skill\ndescription: Guides a workflow. Use when needed.\n---\n# Skill",
      ),
    ).toThrow("Agent Skills contract");
  });
});

describe("PromptLibrary invalid PDF validation", () => {
  it("routes the task to clean-stop guidance", () => {
    const prompts = library();
    const input = {
      task: "Validate every PDF and print INVALID_DOCUMENT_STOP=1 when parsing fails.",
      inputNames: [],
    };
    const body = prompts.activeSkills(input, {
      shell_command_character_limit: "4,096",
      shell_path: "/bin/sh",
      tool_capabilities: "find, grep",
      workspace_path: "/workspace",
    });

    expect([...prompts.activeSkillNames(input)]).toEqual(["pdf-documents"]);
    expect(body).toContain("print that exact marker to stdout");
    expect(body).toContain("exit normally with code 0");
    expect(body).toContain("do not repair the PDF, write an artifact");
    expect(body).toContain("or execute again");
  });
});

describe("PromptLibrary workbook aggregates", () => {
  it("separates new workbook creation from corpus analysis rules", () => {
    const body = library().activeSkills(
      { task: "Create a spreadsheet with these totals.", inputNames: [] },
      {
        shell_command_character_limit: "4,096",
        shell_path: "/bin/sh",
        tool_capabilities: "find, grep",
        workspace_path: "/workspace",
      },
    );
    expect(body).toContain("## Reading and analysis");
    expect(body).toContain("## Creation and editing");
  });

  it("loads one cumulative amount contract", () => {
    const prompts = library();
    const input = { task: "Total matching amounts in every XLSX workbook.", inputNames: [] };
    const body = prompts.activeSkills(input, {
      shell_command_character_limit: "4,096",
      shell_path: "/bin/sh",
      tool_capabilities: "find, grep",
      workspace_path: "/workspace",
    });

    expect([...prompts.activeSkillNames(input)]).toEqual(["xlsx-workbooks"]);
    expect(body).toContain("Discover requested workbooks case-insensitively");
    expect(body).toContain("consume the header from that iterator");
    expect(body).toContain("Compute each requested count, total, average, or grouping");
    expect(body).toContain("atomic checkpoint under `/workspace`");
    expect(body).toContain("never double-count restored values");
    expect(body).toContain("VAULT_PROGRESS_DONE=<integer>");
    expect(body).toContain("Progress, stdout labels, checkpoints, and artifacts agree");
  });
});

describe("PromptLibrary skill routing precision", () => {
  it("does not select PDF guidance just because a source task asks to read text", () => {
    expect([
      ...library().activeSkillNames({
        task: "Inspect this codebase, locate the system prompt, and read it to verify its contents.",
        inputNames: [],
      }),
    ]).toEqual(["terminal-commands"]);
  });

  it("routes explicit DOCX, XLSX, and PDF output requests without generic lexical matches", () => {
    const prompts = library();
    expect([
      ...prompts.activeSkillNames({ task: "Create proposal.docx.", inputNames: [] }),
    ]).toEqual(["docx-documents"]);
    expect([...prompts.activeSkillNames({ task: "Create totals.xlsx.", inputNames: [] })]).toEqual([
      "xlsx-workbooks",
    ]);
    expect([
      ...prompts.activeSkillNames({
        task: "Create a spreadsheet with these totals.",
        inputNames: [],
      }),
    ]).toEqual(["xlsx-workbooks"]);
    expect([
      ...prompts.activeSkillNames({ task: "Create a styled PDF report.", inputNames: [] }),
    ]).toEqual(["pdf-documents"]);
    expect([
      ...prompts.activeSkillNames({ task: "Count words in a text document.", inputNames: [] }),
    ]).not.toContain("docx-documents");
    expect([
      ...prompts.activeSkillNames({ task: "Explain portable document formats.", inputNames: [] }),
    ]).toEqual([]);
    expect([
      ...prompts.activeSkillNames({ task: "Explain PDF, DOCX, and XLSX formats.", inputNames: [] }),
    ]).toEqual([]);
  });

  it("does not select terminal guidance for an explicit Node source-execution task", () => {
    expect([
      ...library().activeSkillNames({
        task: "Use two Node source executions to read an input and write a result.",
        inputNames: [],
      }),
    ]).toEqual([]);
  });
});
