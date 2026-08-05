import { type AgentExecutionResult, AgentEventSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { DurableAgentHistory } from "./history.js";
import { AgentLoop } from "./loop.js";
import {
  completed,
  completeXlsx,
  execute,
  executor,
  expectBoundedSourceSchema,
  inference,
} from "./loop-xlsx-test-support.js";

function discoveredXlsx(command: string): AgentExecutionResult {
  return {
    language: "shell",
    path: null,
    source: null,
    command,
    exitCode: 0,
    stdout: "/source/01 Ianuarie/statement.xlsx\n",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function historicalXlsx(stdout: string): DurableAgentHistory {
  return {
    messages: [],
    runs: [
      {
        state: "succeeded",
        events: [
          AgentEventSchema.parse({
            id: "93ba988b-9593-48e5-b9b3-f852e8cbc23d",
            runId: "bba6ce9a-b98c-4ee7-8c0a-5ccad492d280",
            sequence: 0,
            type: "execution.completed",
            summary: "Processed 36 of 36 XLSX files.",
            language: "python",
            path: "steps/0001.py",
            source: "from openpyxl import load_workbook\nload_workbook('/source/input.xlsx')",
            command: null,
            exitCode: 0,
            stdout,
            stderr: "",
            durationMs: 1,
            termination: "completed",
            createdAt: "2026-08-05T12:21:29.557Z",
          }),
        ],
      },
    ],
  };
}

function expectXlsxDiscoveryInstructions(prompt: string): void {
  expect(prompt).toContain('warnings.filterwarnings("ignore")');
  expect(prompt).toContain("load_workbook(path, read_only=True, data_only=True)");
  expect(prompt).toContain("call `sheet.reset_dimensions()`");
  expect(prompt).toContain("cannot silently hide later rows and columns");
  expect(prompt).toContain('filename.lower().endswith(".xlsx")');
  expect(prompt).toContain('filename.endswith(".xlsx")` is invalid');
  expect(prompt).toContain("keep the workbook accumulator distinct");
  expect(prompt).toContain("process only XLSX workbooks");
  expect(prompt).toContain("DONE and TOTAL count XLSX workbooks only");
  expect(prompt).toContain("complete restored set of completed workbook paths");
  expect(prompt).toContain("immediately add that amount to one cumulative total");
  expect(prompt).toContain(
    "Never use a workbook count, worksheet count, row count, or match count",
  );
  expect(prompt).toContain("checkpoint, requested stdout labels, and any generated artifact");
  expect(prompt).toContain("process it in one pass and do not create or load a checkpoint");
  expect(prompt).toContain("do not build fragile `range(...)` expressions");
  expect(prompt).toContain(
    "compare the fresh case-insensitive corpus with the checkpointed corpus",
  );
}

describe("AgentLoop XLSX routing", () => {
  it("routes bare XLSX wording to source-only work on the first turn", async () => {
    const schemas: Array<Record<string, unknown>> = [];
    const source = "print('XLSX_MATCHES=1\\nXLSX_TOTAL=25')";
    const result = await new AgentLoop(
      inference([execute(source, "Analyze every workbook")], [], schemas),
      executor(
        [{ ...completed, source, stdout: completeXlsx("XLSX_MATCHES=1\nXLSX_TOTAL=25") }],
        [],
      ),
    ).run({
      task: "Analyze every XLSX workbook and print XLSX_MATCHES=<count> and XLSX_TOTAL=<sum>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=1\nXLSX_TOTAL=25");
    expect(schemas[0]).not.toHaveProperty("oneOf");
  });
});

describe("AgentLoop XLSX result follow-ups", () => {
  it("forces evidence retrieval when history contains coverage but no result rows", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const source = "print('| Result |\\n| --- |\\n| avans |')";
    const table = "| Result |\n| --- |\n| avans |";
    const result = await new AgentLoop(
      inference([execute(source, "Read the workbook results")], prompts, schemas),
      executor([{ ...completed, source, stdout: completeXlsx(table, 36) }], calls),
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("Total matches found: 17", 36)),
    });

    expect(result.response).toBe(table);
    expect(calls).toEqual([source]);
    expect(prompts[0]).toContain("xlsx-workbooks (active)");
    expect(schemas[0]).not.toHaveProperty("oneOf");
  });

  it("repairs a table formatter that emitted an invalid pipe escape", async () => {
    const prompts: string[] = [];
    const failedSource = "print('| Result |')";
    const repairedSource = "separator = chr(124)\nprint(separator + ' Result ' + separator)";
    const table = "| Result |\n| --- |\n| avans |";
    const result = await new AgentLoop(
      inference(
        [
          execute(failedSource, "Read the workbook results"),
          execute(repairedSource, "Repair the table formatter"),
        ],
        prompts,
      ),
      executor(
        [
          {
            ...completed,
            source: failedSource,
            stderr: "SyntaxWarning: '\\|' is an invalid escape sequence",
          },
          { ...completed, source: repairedSource, stdout: completeXlsx(table, 36) },
        ],
        [],
      ),
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("Total matches found: 17", 36)),
    });

    expect(result.response).toBe(table);
    expect(prompts[1]).toContain("invalid escape-sequence warning");
    expect(prompts[1]).toContain("Construct the table separator with `chr(124)`");
    expect(prompts[1]).toContain("with a space instead of a backslash escape");
    expect(prompts[1]).toContain("include the required XLSX coverage markers");
  });

  it("repairs reset_dimensions use on a normal worksheet", async () => {
    const prompts: string[] = [];
    const failedSource = "load_workbook('/workspace/avans_results.xlsx').active.reset_dimensions()";
    const repairedSource = "workbook = load_workbook('/workspace/avans_results.xlsx', data_only=True)";
    const table = "| Result |\n| --- |\n| avans |";
    const result = await new AgentLoop(
      inference(
        [
          execute(failedSource, "Read the generated workbook"),
          execute(repairedSource, "Read the generated workbook without dimension recovery"),
        ],
        prompts,
      ),
      executor(
        [
          {
            ...completed,
            source: failedSource,
            exitCode: 1,
            stderr: "AttributeError: 'Worksheet' object has no attribute 'reset_dimensions'",
          },
          { ...completed, source: repairedSource, stdout: completeXlsx(table, 36) },
        ],
        [],
      ),
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("Total matches found: 17", 36)),
    });

    expect(result.response).toBe(table);
    expect(prompts[1]).toContain("called `reset_dimensions()` on a normal OpenPyXL `Worksheet`");
    expect(prompts[1]).toContain("Use `load_workbook(..., read_only=True, data_only=True)`");
    expect(prompts[1]).toContain(
      "When reopening the generated `/workspace` workbook normally, do not call `reset_dimensions()`",
    );
  });

  it("keeps presentation-only follow-ups response-only when history contains results", async () => {
    const schemas: Array<Record<string, unknown>> = [];
    const result = await new AgentLoop(
      inference([{ action: "respond", response: "Reformatted table." }], [], schemas),
      {
        async execute() {
          throw new Error("Presentation-only follow-up should not execute.");
        },
      },
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("| Result |\n| --- |\n| avans |", 36)),
    });

    expect(result.response).toBe("Reformatted table.");
    expect(schemas[0]).toHaveProperty("oneOf");
  });
});

describe("AgentLoop XLSX progress", () => {
  it("advances after an empty inspection and returns verified calculation stdout", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const inspection = "print('inspection')";
    const calculation = "print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')";
    const resultEvidence = {
      ...completed,
      source: calculation,
      stdout: completeXlsx("XLSX_MATCHES=2\nXLSX_TOTAL=2003"),
    };
    const result = await new AgentLoop(
      inference(
        [execute(inspection, "Inspect"), execute(calculation, "Calculate")],
        prompts,
        schemas,
      ),
      executor([{ ...completed, source: inspection }, resultEvidence], calls),
    ).run({
      task: "Use Python to find VAULT_STRESS_TARGET in every .xlsx row.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=2\nXLSX_TOTAL=2003");
    expect(calls).toEqual([inspection, calculation]);
    expect(prompts[0]).toContain("Choose the simplest bounded strategy");
    expectXlsxDiscoveryInstructions(prompts[0] ?? "");
    expect(prompts[0]).toContain("Close each workbook in a finally block");
    expect(prompts[0]).toContain("for sheet in workbook.worksheets");
    expect(prompts[0]).toContain("never break or return from the worksheet loop");
    expect(prompts[0]).toContain("process it in one pass and do not create or load a checkpoint");
    expect(prompts[0]).toContain("resumed executions never double count it");
    expect(prompts[0]).toContain("never persist or reuse an old start time");
    expect(prompts[0]).toContain("never True, False, or a comparison expression");
    expect(prompts[0]).toContain("VAULT_XLSX_FILES_DONE=<integer>");
    expect(prompts[0]).toContain("at most 160 complete source lines");
    expect(prompts[0]).not.toContain("adapt these complete source lines");
    expect(prompts[1]).toContain(
      "Current required phase: recover from an incomplete XLSX execution",
    );
    expect(schemas).toHaveLength(2);
    expect(schemas.every((schema) => !Object.hasOwn(schema, "oneOf"))).toBe(true);
    expectBoundedSourceSchema(schemas[0] ?? {});
  });
});

describe("AgentLoop whitespace-delimited XLSX progress", () => {
  it("returns a clean execution when all exact markers share one line", async () => {
    const source = "print('done')";
    const stdout = [
      "No salary transactions found.",
      "VAULT_XLSX_FILES_DONE=36 VAULT_XLSX_FILES_TOTAL=36 VAULT_XLSX_COMPLETE=1",
    ].join("\n");
    const result = await new AgentLoop(
      inference([execute(source, "Inspect")], [], []),
      executor([{ ...completed, source, stdout }], []),
    ).run({ task: "Inspect every .xlsx file.", modelId: "test-model" });

    expect(result.response).toBe("No salary transactions found.");
  });
});

describe("AgentLoop discovered XLSX routing", () => {
  it("promotes a salary task to the source-only XLSX workflow after file discovery", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const discovery = "find /source -iname '*.xlsx'";
    const analysis = "print('salary analysis')";
    const result = await new AgentLoop(
      inference(
        [
          { action: "execute", language: "shell", command: discovery, summary: "Discover" },
          execute(analysis, "Analyze"),
        ],
        prompts,
        schemas,
      ),
      executor(
        [
          discoveredXlsx(discovery),
          {
            ...completed,
            source: analysis,
            stdout: completeXlsx("ALL_MONTHS=12"),
          },
        ],
        calls,
      ),
    ).run({
      task: "Gaseste toate tranzactiile care contin salariu pentru fiecare luna.",
      modelId: "test-model",
    });

    expect(result.response).toBe("ALL_MONTHS=12");
    expect(calls).toEqual([discovery, analysis]);
    expect(prompts[0]).toContain("terminal-commands (available)");
    expect(prompts[0]).not.toContain("use -iname instead of -name");
    expect(prompts[0]).not.toContain("VAULT_XLSX_FILES_DONE");
    expect(prompts[1]).toContain("VAULT_XLSX_FILES_DONE");
    expect(prompts[1]).toContain("Current required phase: perform bounded XLSX work.");
    expect(prompts[1]).not.toContain("recover from an incomplete XLSX execution");
    expect(schemas[0]).toHaveProperty("oneOf");
    expect(schemas[1]).not.toHaveProperty("oneOf");
  });
});

describe("AgentLoop XLSX inspection repair", () => {
  it("repairs a crashed inspection with streaming workbook guidance", async () => {
    const prompts: string[] = [];
    const failedSource = "print('failed')";
    const repairedSource = "print('inspection')";
    const calculation = "print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')";
    const result = await new AgentLoop(
      inference(
        [
          execute(failedSource, "Inspect"),
          execute(repairedSource, "Repair inspection"),
          execute(calculation, "Calculate"),
        ],
        prompts,
      ),
      executor(
        [
          {
            ...completed,
            source: failedSource,
            exitCode: 255,
            termination: "crash",
          },
          { ...completed, source: repairedSource },
          {
            ...completed,
            source: calculation,
            stdout: completeXlsx("XLSX_MATCHES=2\nXLSX_TOTAL=2003"),
          },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file. Print XLSX_MATCHES=<count> and XLSX_TOTAL=<sum>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=2\nXLSX_TOTAL=2003");
    expect(prompts[1]).toContain(
      "Current required phase: recover from an incomplete XLSX execution",
    );
    expect(prompts[1]).toContain("replace it with a different bounded strategy");
    expect(prompts[1]).toContain("read_only=True");
    expect(prompts[2]).toContain("including the 75-second checkpoint path");
  });
});

describe("AgentLoop XLSX result repair", () => {
  it("repairs a calculation that omits a required output label", async () => {
    const prompts: string[] = [];
    const calculation = "print('calculation')";
    const repair = "print('XLSX_MATCHES=2\\nWORD_PAGES=36')";
    const result = await new AgentLoop(
      inference(
        [
          execute("print('inspect')", "Inspect"),
          execute(calculation, "Calculate"),
          execute(repair, "Repair"),
        ],
        prompts,
      ),
      executor(
        [
          { ...completed, source: "print('inspect')" },
          { ...completed, source: calculation, stdout: completeXlsx("XLSX_MATCHES=2") },
          {
            ...completed,
            source: repair,
            stdout: completeXlsx("XLSX_MATCHES=2\nWORD_PAGES=36"),
          },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file. Print XLSX_MATCHES=<count> and WORD_PAGES=<count>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=2\nWORD_PAGES=36");
    expect(prompts[2]).toContain(
      "Current required phase: recover from an incomplete XLSX execution",
    );
  });
});

describe("AgentLoop mixed-format result repair", () => {
  it("repairs a complete XLSX result when a sibling format wrote an error", async () => {
    const first = "print('partial mixed result')";
    const repair = "print('repaired mixed result')";
    const result = await new AgentLoop(
      inference(
        [execute(first, "Process both formats"), execute(repair, "Repair DOCX processing")],
        [],
      ),
      executor(
        [
          {
            ...completed,
            source: first,
            stdout: completeXlsx("XLSX_MATCHES=4\nXLSX_TOTAL=6006\nWORD_PAGES=0\nWORD_CHECKSUM=0"),
            stderr: "DOCX parse failed\n",
          },
          {
            ...completed,
            source: repair,
            stdout: completeXlsx(
              "XLSX_MATCHES=4\nXLSX_TOTAL=6006\nWORD_PAGES=36\nWORD_CHECKSUM=72234",
            ),
          },
        ],
        [],
      ),
    ).run({
      task: "Inspect XLSX and DOCX. Print XLSX_MATCHES=<count>, XLSX_TOTAL=<sum>, WORD_PAGES=<count>, and WORD_CHECKSUM=<sum>.",
      modelId: "test-model",
      inputNames: ["input.xlsx"],
    });

    expect(result.response).toBe(
      "XLSX_MATCHES=4\nXLSX_TOTAL=6006\nWORD_PAGES=36\nWORD_CHECKSUM=72234",
    );
  });
});
