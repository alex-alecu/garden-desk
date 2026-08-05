import { AgentEventSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { DurableAgentHistory } from "./history.js";
import { AgentLoop } from "./loop.js";
import { completed, completeXlsx, execute, executor, inference } from "./loop-xlsx-test-support.js";

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
});

describe("AgentLoop XLSX table escape recovery", () => {
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
    expect(prompts[1]).toContain("Do not call `replace` on backslash characters");
    expect(prompts[1]).toContain("one dash-based separator row");
    expect(prompts[1]).toContain("Count printed data rows with an integer variable");
    expect(prompts[1]).toContain("Print no prose, totals, or blank content outside the table");
    expect(prompts[1]).toContain("include the required XLSX coverage markers");
  });
});

describe("AgentLoop XLSX table column normalization", () => {
  it("returns rows with overflow separators in the final cell", async () => {
    const source = "print('| Source | Row |')";
    const malformed = "| Source | Row |\n| --- | --- |\n| input.xlsx | amount |avans |";
    const table = "| Source | Row |\n| --- | --- |\n| input.xlsx | amount avans |";
    const result = await new AgentLoop(
      inference([execute(source, "Read the workbook results")], []),
      executor([{ ...completed, source, stdout: malformed }], []),
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("Total matches found: 17", 36)),
    });

    expect(result.response).toBe(table);
  });
});

describe("AgentLoop XLSX plain-result recovery", () => {
  it("keeps table follow-ups executable until stdout contains a verified table", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const plainSource = "print('Saved 17 matches')";
    const tableSource = "print('| Result |\\n| --- |\\n| avans |')";
    const table = "| Result |\n| --- |\n| avans |";
    const result = await new AgentLoop(
      inference(
        [
          execute(plainSource, "Read the workbook results"),
          execute(tableSource, "Print the workbook results as a table"),
        ],
        prompts,
        schemas,
      ),
      executor(
        [
          { ...completed, source: plainSource, stdout: completeXlsx("Saved 17 matches", 36) },
          { ...completed, source: tableSource, stdout: completeXlsx(table, 36) },
        ],
        [],
      ),
    ).run({
      task: "Give me a table direct in chat with all the results",
      modelId: "test-model",
      history: historicalXlsx(completeXlsx("Total matches found: 17", 36)),
    });

    expect(result.response).toBe(table);
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(prompts[1]).toContain("did not produce a verified GFM table");
    expect(prompts[1]).toContain("include the required XLSX coverage markers");
  });
});

describe("AgentLoop XLSX table dimension recovery", () => {
  it("repairs reset_dimensions use on a normal worksheet", async () => {
    const prompts: string[] = [];
    const failedSource = "load_workbook('/workspace/avans_results.xlsx').active.reset_dimensions()";
    const repairedSource =
      "workbook = load_workbook('/workspace/avans_results.xlsx', data_only=True)";
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
});

describe("AgentLoop XLSX presentation follow-ups", () => {
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
