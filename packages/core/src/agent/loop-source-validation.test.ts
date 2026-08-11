import { describe, expect, it } from "vitest";
import { rejectedExecutionReason, rejectedExecutionReasonWithContext } from "./loop-decisions.js";
import { newProgress } from "./loop-turn.js";
import { generationInput } from "./prompt.js";
import { generationSchema } from "./prompt-generation-schema.js";
import { defaultPromptLibrary } from "./prompt-library.js";

function python(source: string) {
  return { action: "execute", language: "python", source, summary: "Validate" } as const;
}

function skillRejection(source: string, task: string) {
  const library = defaultPromptLibrary();
  const active = library.activeSkillNames({ task, inputNames: [] });
  const reason = library.sourceRejection(active, source);
  return rejectedExecutionReasonWithContext(python(source), [], {
    rejectIncompleteSource: true,
    task,
    ...(reason === undefined ? {} : { skillRejection: reason }),
  });
}

describe("agent source validation", () => {
  it("rejects a source line truncated at the structured generation boundary", () => {
    expect(rejectedExecutionReason(python(`print('done')${"0".repeat(500)}`), [])).toBe("invalid");
  });

  it("rejects an uncalled entry point", () => {
    expect(rejectedExecutionReason(python("def main():\n    print('done')"), [])).toBe("invalid");
  });

  it("rejects a helper that mutates an unbound Python local", () => {
    const broken = "DONE = 0\ndef process():\n    DONE += 1\nprocess()";
    expect(rejectedExecutionReason(python(broken), [])).toBe("invalid");
  });

  it.each([
    "def process():\n    done = 0\n    done += 1\nprocess()",
    "DONE = 0\ndef process():\n    global DONE\n    DONE += 1\nprocess()",
  ])("allows bound Python mutations", (source) => {
    expect(rejectedExecutionReason(python(source), [])).toBeUndefined();
  });

  it("rejects an XLSX header comprehension with an unbound value name", () => {
    const broken = "header_map = {str(h).casefold(): i for i in range(len(header))}";
    expect(skillRejection(broken, "Inspect every XLSX workbook.")).toBe("invalid");
    const valid =
      "header_map = {str(value).casefold(): index for index, value in enumerate(header)}";
    expect(rejectedExecutionReason(python(valid), [])).toBeUndefined();
  });
});

describe("complete table source validation", () => {
  it("rejects numeric slicing when the task requires a complete table", () => {
    const task = "Search all workbooks and return the results in a nice table.";
    expect(rejectedExecutionReason(python("print(data[:40])"), [], false, task)).toBe(
      "table_truncation",
    );
    expect(rejectedExecutionReason(python("print(data)"), [], false, task)).toBeUndefined();
  });

  it("rejects iterating the first scalar field instead of every expanded result field", () => {
    const task = "Search all Excel files and return the results in a nice table.";
    const prefix = "results.append([path, sheet.title, *row])\n";
    const broken = `${prefix}for result in results:\n    print(' '.join(str(c) for c in result[2]))`;
    expect(rejectedExecutionReason(python(broken), [], false, task)).toBe("table_truncation");
    const valid = `${prefix}for result in results:\n    print(' '.join(str(c) for c in result[2:]))`;
    expect(rejectedExecutionReason(python(valid), [], false, task)).toBeUndefined();
  });

  it("rejects an unrequested workbook when the task explicitly requires a table here", () => {
    const task = "Search all Excel files for revenue and return the results in a nice table here.";
    const artifact = "workbook.save('/workspace/revenue_summary.xlsx')";
    expect(rejectedExecutionReason(python(artifact), [], false, task)).toBe("table_truncation");
    expect(
      rejectedExecutionReason(
        python(artifact),
        [],
        false,
        "Search all Excel files and save results.xlsx, then show a table here.",
      ),
    ).toBeUndefined();
  });

  it.each([
    "print(f'Source{sep}Sheet{sep}Data')",
    "print(f'Source{sep}Sheet{sep}{sep}'.join(columns))",
  ])("rejects a malformed complete direct-table header", (header) => {
    const task = "Search all Excel files and return every result in a table here.";
    const source = `results.append([path, sheet.title, *row])\n${header}`;
    expect(rejectedExecutionReason(python(source), [], false, task)).toBe("table_truncation");
  });

  it("allows an explicitly requested table subset", () => {
    const task = "Return the first 10 results in a table.";
    expect(rejectedExecutionReason(python("print(data[:10])"), [], false, task)).toBeUndefined();
  });
});

describe("oversized table source validation", () => {
  it("rejects chat-table source when the complete result is explicitly too large for chat", () => {
    const task =
      "Search every workbook and return all rows in a table. Return the complete result even when it is too large for the chat response.";
    const chat = "results.append([path, sheet.title, *row])\nfor result in results: emit(result)";
    expect(rejectedExecutionReason(python(chat), [], false, task)).toBe("table_truncation");
    const artifact = `${chat}\nworkbook.save('/workspace/results.xlsx')`;
    expect(rejectedExecutionReason(python(artifact), [], false, task)).toBeUndefined();
  });
});

describe("document source validation", () => {
  it("gives a complete-table repair enough bounded source lines", () => {
    const progress = newProgress();
    progress.lastRejectedProgramReason = "table_truncation";
    const schema = generationSchema(
      { task: "Search all workbooks and return a complete table.", modelId: "test-model" },
      progress,
      false,
      undefined,
    );
    expect(JSON.stringify(schema)).toContain('"maxItems":80');
  });

  it("rejects len() around OpenPyXL's integer max_row property", () => {
    expect(
      skillRejection("assert len(workbook.active.max_row) > 0", "Create an XLSX workbook."),
    ).toBe("unsupported_document_api");
  });

  it("rejects load_workbook as a Workbook instance method", () => {
    expect(
      skillRejection(
        "workbook = Workbook()\nworkbook.load_workbook('/workspace/report.xlsx')",
        "Create report.xlsx.",
      ),
    ).toBe("unsupported_document_api");
    expect(
      rejectedExecutionReason(
        python("repository = CustomRepository()\nrepository.load_workbook('id')"),
        [],
        false,
        "Inspect a custom repository.",
      ),
    ).toBeUndefined();
  });
});

describe("direct table recovery", () => {
  it("does not inject the artifact-only program shape after malformed source", () => {
    const progress = newProgress();
    progress.lastRejectedProgramReason = "invalid";
    const request = generationInput(
      {
        task: "Search all Excel files and return the results in a nice table here.",
        modelId: "test-model",
      },
      progress,
    );
    expect(request.prompt).not.toContain("Use this short artifact-first shape");
    expect(request.prompt).toContain("Use this short direct-table shape");
    expect(JSON.stringify(request.jsonSchema)).toContain('"maxItems":64');
  });

  it("injects a compact aggregate shape for labeled workbook analysis", () => {
    const request = generationInput(
      {
        task: "Analyze every XLSX and report TOTAL_AVANS=<value>.",
        modelId: "test-model",
      },
      newProgress(),
    );
    expect(request.prompt).toContain("Use this short aggregate-analysis shape");
    expect(request.prompt).toContain("increment `done` once outside the worksheet loop");
  });

  it("injects the artifact-first shape before an explicitly oversized table attempt", () => {
    const request = generationInput(
      {
        task: "Return all workbook rows in a table even when it is too large for the chat response.",
        modelId: "test-model",
      },
      newProgress(),
    );
    expect(request.prompt).toContain("Use this short artifact-first shape");
    expect(JSON.stringify(request.jsonSchema)).toContain('"maxItems":80');
  });
});

describe("multi-format recovery", () => {
  it("uses a compact analysis-only shape for a first report turn", () => {
    const progress = newProgress();
    progress.lastRejectedProgramReason = "invalid";
    const request = generationInput(
      {
        task: [
          "Review every XLSX, DOCX, and PDF.",
          "The report must visibly label the results as MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES.",
          "Create large-corpus-report.xlsx.",
        ].join(" "),
        modelId: "test-model",
      },
      progress,
      false,
      { contextTokens: 32_768 },
    );
    expect(request.prompt).toContain("Use this short multi-format analysis shape");
    expect(request.prompt).toContain("Do not create the requested deliverable in this execution");
    expect(request.prompt).not.toContain("Use this short artifact-first shape");
  });
});

describe("progress marker validation", () => {
  it("rejects missing and malformed required progress markers", () => {
    expect(
      rejectedExecutionReason(python("print('done')"), [], true, "Search workbooks."),
    ).toBeUndefined();
    const previous: import("@vault/shared").AgentExecutionResult = {
      language: "python",
      path: "steps/0001.py",
      source: "print('old')",
      command: null,
      exitCode: 0,
      stdout: "incomplete",
      stderr: "",
      durationMs: 1,
      termination: "completed",
      artifacts: [],
    };
    expect(
      rejectedExecutionReason(python("print('done')"), [previous], true, "Search workbooks."),
    ).toBe("progress_markers");
    const missingValue = [
      "print('VAULT_PROGRESS_DONE')",
      "print(f'VAULT_PROGRESS_TOTAL={total}')",
      "print(f'VAULT_PROGRESS_COMPLETE={1 if done == total else 0}')",
    ].join("\n");
    expect(rejectedExecutionReason(python(missingValue), [], true, "Search workbooks.")).toBe(
      "progress_markers",
    );
    const complete = [
      "print(f'VAULT_PROGRESS_DONE={done}')",
      "print(f'VAULT_PROGRESS_TOTAL={total}')",
      "print(f'VAULT_PROGRESS_COMPLETE={1 if done == total else 0}')",
    ].join("\n");
    expect(
      rejectedExecutionReason(python(complete), [], true, "Search workbooks."),
    ).toBeUndefined();
  });
});

describe("progress marker placement", () => {
  it("rejects completion markers inside a corpus loop", () => {
    const source = [
      "for path in paths:",
      "    print(f'VAULT_PROGRESS_DONE={done}')",
      "print(f'VAULT_PROGRESS_DONE={done}')",
    ].join("\n");
    expect(rejectedExecutionReason(python(source), [], true, "Search every workbook.")).toBe(
      "progress_inside_loop",
    );
    expect(
      rejectedExecutionReason(
        python("for path in paths:\n    process(path)\nprint(f'VAULT_PROGRESS_DONE={done}')"),
        [],
        true,
        "Search every workbook.",
      ),
    ).toBe("progress_markers");
  });

  it("rejects workbook progress increments inside a worksheet loop", () => {
    const broken = [
      "for path in corpus:",
      "    workbook = load_workbook(path)",
      "    for sheet in workbook.worksheets:",
      "        process(sheet)",
      "        DONE += 1",
    ].join("\n");
    expect(skillRejection(broken, "Search every XLSX workbook.")).toBe("progress_inside_loop");
  });
});

describe("certified document APIs", () => {
  it.each([
    "from openpyxl.worksheet.page_setup import PageSetup",
    "from pypdf.generic import PageObject",
    "writer.title = 'Board Pack'",
  ])("rejects unsupported certified document APIs: %s", (source) => {
    const task =
      source.includes("pypdf") || source.includes("writer") ? "Create a PDF." : "Create an XLSX.";
    expect(skillRejection(source, task)).toBe("unsupported_document_api");
  });
});
