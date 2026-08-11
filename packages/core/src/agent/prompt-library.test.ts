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

describe("PromptLibrary plain-language search routing", () => {
  it("routes a plain-language Excel search request directly to the workbook skill", () => {
    const prompts = library();
    const input = {
      task: "Search all excel files in current folder for revenue that came into the business and return the results in a nice table here",
      inputNames: [],
    };
    expect([...prompts.activeSkillNames(input)]).toEqual(["xlsx-workbooks"]);
  });

  it("routes a Romanian workbook search request to the workbook skill", () => {
    expect([
      ...library().activeSkillNames({
        task: "Caută în toate registrele Excel din folder veniturile încasate.",
        inputNames: [],
      }),
    ]).toEqual(["xlsx-workbooks"]);
  });
});

describe("PromptLibrary workbook progress scope", () => {
  it("keeps corpus progress for analysis but excludes targeted workbook edits", () => {
    const prompts = library();
    const active = new Set(["xlsx-workbooks"]);
    expect(prompts.progressSkill(active, "Search all Excel files for revenue.")?.name).toBe(
      "xlsx-workbooks",
    );
    expect(prompts.progressSkill(active, "Edit Budget!B3 and save revised-budget.xlsx.")).toBe(
      undefined,
    );
  });
});

describe("PromptLibrary Romanian skill selection", () => {
  it.each([
    "Analizează registrele cu salarii și avansuri din acest folder.",
    "Calculează totalul pentru tranzacții din toate registrele.",
    "Raportează valorile din tabelele cu avansuri.",
  ])("routes workbook requests with Unicode word boundaries", (task) => {
    expect([...library().activeSkillNames({ task, inputNames: [] })]).toEqual(["xlsx-workbooks"]);
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
    expect(body).toContain("print the exact marker");
    expect(body).toContain("exit 0");
    expect(body).toContain("do not repair, create, traceback, or retry");
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
});

describe("PromptLibrary workbook corpus contract", () => {
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
    expect(body).toContain("Build one complete sorted corpus");
    expect(body).toContain('name.casefold().endswith(".xlsx")');
    expect(body).toContain("Include upper/mixed-case extensions");
    expect(body).toContain("Never use flat `os.listdir`/`glob`");
    expect(body).toContain("`sheet in workbook.worksheets`");
    expect(body).toContain("`header = next(rows)`");
    expect(body).toContain("for index, value in enumerate(header)");
    expect(body).toContain("Row values are scalars: never use `.value`");
    expect(body).toContain("`VAULT_PROGRESS_DONE`");
    expect(body).toContain("`VAULT_PROGRESS_TOTAL`");
    expect(body).toContain("`VAULT_PROGRESS_COMPLETE`");
    expect(body).toContain("never search target words in header names");
    expect(body).toContain("Use `flow_index` from `cash_flow`/`direction`/`flow`");
    expect(body).toContain('complete chat table uses columns `["Source", "Sheet", *header]`');
    expect(body).toContain("print the complete table directly");
    expect(body).toContain("Never nest fields in `Data`");
    expect(body).toContain('`["---"] * len(columns)`');
    expect(body).toContain("append scalar rows `[source_path, sheet.title, *row]`");
    expect(body).toContain("atomically checkpoint completed sorted paths");
    expect(body).toContain("`VAULT_PROGRESS_COMPLETE` exactly once");
    expect(body).toContain("For all/every/complete rows from multiple workbooks");
    expect(body).toContain("unless the task explicitly requires a direct chat table");
    expect(body).toContain("do not render a chat table first");
    expect(body).toContain("above 100 lines or 64,000 characters");
    expect(body).toContain("Never abbreviate or claim an undeclared file");
    expect(prompts.skillRecovery("xlsx-workbooks", "program-shape")).toContain(
      "Use this short artifact-first shape",
    );
    expect(
      prompts.repairPrompts(new Set(["xlsx-workbooks"]), "SyntaxError: '(' was never closed"),
    ).toEqual(expect.arrayContaining([expect.stringContaining("fresh, complete, small program")]));
  });
});

describe("PromptLibrary active deliverable states", () => {
  it("loads format creation details only for active skills", () => {
    const prompts = library();
    expect(prompts.activeSkillStates(new Set(["pdf-documents"]), "deliverable-create")).toEqual([
      expect.stringContaining("never `reportlab.lib.pages`"),
    ]);
    expect(prompts.activeSkillStates(new Set(["terminal-commands"]), "deliverable-create")).toEqual(
      [],
    );
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
