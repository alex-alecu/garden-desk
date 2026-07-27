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
    expect(prompts[0]).toContain("load_workbook(path, read_only=True, data_only=True)");
    expect(prompts[0]).toContain("Close each workbook in a finally block");
    expect(prompts[0]).toContain("for sheet in workbook.worksheets");
    expect(prompts[0]).toContain("never break or return from the worksheet loop");
    expect(prompts[0]).toContain("finish a small corpus in one short pass without checkpointing");
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
