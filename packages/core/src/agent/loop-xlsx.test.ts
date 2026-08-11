import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
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

function progressSource(body: string): string {
  return [
    body,
    "print('VAULT_PROGRESS_DONE=1')",
    "print('VAULT_PROGRESS_TOTAL=1')",
    "print('VAULT_PROGRESS_COMPLETE=1')",
  ].join("\n");
}

function expectXlsxDiscoveryInstructions(prompt: string): void {
  expect(prompt).toContain("load_workbook(path, read_only=True, data_only=True)");
  expect(prompt).toContain("Include upper/mixed-case extensions");
  expect(prompt).toContain("Never use flat `os.listdir`/`glob`");
  expect(prompt).toContain("`header = next(rows)`");
  expect(prompt).toContain("Locate roles from header aliases");
  expect(prompt).toContain("After all loops");
  expect(prompt).toContain("atomically checkpoint completed sorted paths");
}

describe("AgentLoop XLSX progress", () => {
  it("advances after an empty inspection and returns verified calculation stdout", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const inspection = "print('inspection')";
    const calculation = progressSource("print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')");
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
    expect(prompts[0]).toContain("Prefer one bounded program");
    expectXlsxDiscoveryInstructions(prompts[0] ?? "");
    expect(prompts[0]).toContain("Close workbooks in `finally`");
    expect(prompts[0]).toContain("`sheet in workbook.worksheets`");
    expect(prompts[0]).toContain("cumulative results");
    expect(prompts[0]).toContain("COMPLETE is 1 only when DONE equals TOTAL");
    expect(prompts[0]).toContain("`VAULT_PROGRESS_DONE`");
    expect(prompts[0]).toContain("at most 80 complete source lines");
    expect(prompts[0]).not.toContain("adapt these complete source lines");
    expect(prompts[1]).toContain(
      "Current required phase: recover from an incomplete workbook execution",
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
      "VAULT_PROGRESS_DONE=36 VAULT_PROGRESS_TOTAL=36 VAULT_PROGRESS_COMPLETE=1",
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
    const analysis = progressSource("print('salary analysis')");
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
    expect(prompts[0]).not.toContain("VAULT_PROGRESS_DONE");
    expect(prompts[1]).toContain("VAULT_PROGRESS_DONE");
    expect(prompts[1]).toContain("Current required phase: perform bounded workbook work.");
    expect(prompts[1]).not.toContain("recover from an incomplete workbook execution");
    expect(schemas[0]).toHaveProperty("oneOf");
    expect(schemas[1]).not.toHaveProperty("oneOf");
  });
});

describe("AgentLoop XLSX inspection repair", () => {
  it("repairs a crashed inspection with streaming workbook guidance", async () => {
    const prompts: string[] = [];
    const failedSource = "print('failed')";
    const repairedSource = progressSource("print('inspection')");
    const calculation = progressSource("print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')");
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
      "Current required phase: recover from an incomplete workbook execution",
    );
    expect(prompts[1]).toContain("replace it with a different bounded strategy");
    expect(prompts[1]).toContain("read_only=True");
    expect(prompts[2]).toContain("including the 75-second checkpoint path");
  });
});

describe("AgentLoop XLSX result repair", () => {
  it("repairs a calculation that omits a required output label", async () => {
    const prompts: string[] = [];
    const calculation = progressSource("print('calculation')");
    const repair = progressSource("print('XLSX_MATCHES=2\\nWORD_PAGES=36')");
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
      "Current required phase: recover from an incomplete workbook execution",
    );
  });
});

describe("AgentLoop mixed-format result repair", () => {
  it("repairs a complete XLSX result when a sibling format wrote an error", async () => {
    const first = "print('partial mixed result')";
    const repair = progressSource("print('repaired mixed result')");
    const result = await new AgentLoop(
      inference(
        [
          execute(first, "Process both formats"),
          execute(repair, "Repair DOCX processing"),
          { action: "respond", response: "Done." },
        ],
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
