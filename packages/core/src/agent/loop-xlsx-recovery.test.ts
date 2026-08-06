import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { AgentLoop } from "./loop.js";
import { completed, completeXlsx, execute, executor, inference } from "./loop-xlsx-test-support.js";
import { progressContinuationResponse } from "./output-contract.js";

describe("AgentLoop XLSX coverage repair", () => {
  it("asks for missing progress markers after otherwise complete output", async () => {
    const prompts: string[] = [];
    const source = "print('XLSX_MATCHES=4')";
    const repaired = "print('XLSX_MATCHES=4\\nVAULT_PROGRESS_COMPLETE=1')";
    await new AgentLoop(
      inference([execute(source, "Scan"), execute(repaired, "Add coverage evidence")], prompts),
      executor(
        [
          { ...completed, source, stdout: "XLSX_MATCHES=4\n" },
          { ...completed, source: repaired, stdout: completeXlsx("XLSX_MATCHES=4") },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file and print XLSX_MATCHES=<count>.",
      modelId: "test-model",
    });

    expect(prompts[1]).toContain("did not prove complete workbook coverage");
    expect(prompts[1]).toContain("Reuse or replace the working calculation");
    expect(prompts[1]).toContain("Do not respond and do not repeat the unchanged source");
  });
});

describe("AgentLoop XLSX checkpoint repair", () => {
  it("requires progress markers on a clean partial exit", async () => {
    const prompts: string[] = [];
    const source = "print('Checkpoint saved')";
    const repaired = "print('XLSX_MATCHES=4\\nVAULT_PROGRESS_COMPLETE=1')";
    await new AgentLoop(
      inference([execute(source, "Scan"), execute(repaired, "Add progress")], prompts),
      executor(
        [
          { ...completed, source, stdout: "Checkpoint saved at index 17\n" },
          { ...completed, source: repaired, stdout: completeXlsx("XLSX_MATCHES=4") },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file and print XLSX_MATCHES=<count>.",
      modelId: "test-model",
    });

    expect(prompts[1]).toContain("including the 75-second checkpoint path");
    expect(prompts[1]).toContain("Do not repeat the unchanged source");
  });
});

describe("AgentLoop XLSX row serialization repair", () => {
  it("explains that appended workbook rows must be flat scalar sequences", async () => {
    const prompts: string[] = [];
    const broken = "output.append([source_path, sheet_name, row_values])";
    const repaired = "output.append([source_path, sheet_name, *row_values])";
    await new AgentLoop(
      inference(
        [execute(broken, "Collect filtered rows"), execute(repaired, "Flatten copied values")],
        prompts,
      ),
      executor(
        [
          {
            ...completed,
            source: broken,
            stderr: "Cannot convert ['2026-08-01', 1000, 'avans'] to Excel",
          },
          { ...completed, source: repaired, stdout: completeXlsx("Saved filtered workbook") },
        ],
        [],
      ),
    ).run({
      task: "Generate an excel with all rows in excel files containing avans",
      modelId: "test-model",
    });

    expect(prompts[1]).toContain("passed a list or tuple as one output cell");
    expect(prompts[1]).toContain("output.append([source_path, sheet_name, *row_values])");
    expect(prompts[1]).toContain(
      "do not use `output.append([source_path, sheet_name, row_values])`",
    );
  });
});

describe("AgentLoop XLSX Python syntax repair", () => {
  it("requires a fresh valid program after malformed exception handling", async () => {
    const prompts: string[] = [];
    const broken = "try:\n    pass\nfinally:\n    pass\nexcept Exception:\n    pass";
    const repaired = "try:\n    print('done')\nexcept Exception:\n    raise";
    await new AgentLoop(
      inference(
        [execute(broken, "Collect filtered rows"), execute(repaired, "Rebuild valid program")],
        prompts,
      ),
      executor(
        [
          { ...completed, source: broken, stderr: "SyntaxError: invalid syntax" },
          { ...completed, source: repaired, stdout: completeXlsx("Saved filtered workbook") },
        ],
        [],
      ),
    ).run({
      task: "Generate an excel with all rows in excel files containing avans",
      modelId: "test-model",
    });

    expect(prompts[1]).toContain("Discard it instead of patching the malformed block");
    expect(prompts[1]).toContain("never put an `except` after a completed `finally`");
    expect(prompts[1]).toContain("append only flat scalar output rows");
  });
});

describe("AgentLoop duplicate stall", () => {
  it("fails after the model repeats the same program twice", async () => {
    const prompts: string[] = [];
    const calls: string[] = [];
    const repeated = execute("print('same')", "Repeat");
    const loop = new AgentLoop(
      inference([repeated, repeated, repeated], prompts),
      executor([{ ...completed, source: "print('same')", stdout: "same\n" }], calls),
    );

    await expect(loop.run({ task: "Inspect input", modelId: "test-model" })).rejects.toThrow(
      "agent_stalled_duplicate",
    );
    expect(calls).toEqual(["print('same')"]);
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain("Rejected duplicate or pathologically repetitive programs: 1.");
  });
});

describe("AgentLoop invalid program rejection", () => {
  it("rejects pathological source repetition without consuming an execution", async () => {
    const prompts: string[] = [];
    const calls: string[] = [];
    const repetitive = execute(Array.from({ length: 48 }, () => "import os").join("\n"), "Scan");
    const incomplete = execute("import os\nfrom openpyxl import load_workbook", "Scan");
    const valid = execute("print('done')", "Use a fresh short strategy");
    const result = await new AgentLoop(
      inference([repetitive, incomplete, incomplete, incomplete, valid], prompts),
      executor(
        [{ ...completed, source: "print('done')", stdout: completeXlsx("XLSX_MATCHES=1") }],
        calls,
      ),
    ).run({
      task: "Inspect every .xlsx file and print XLSX_MATCHES=<count>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=1");
    expect(calls).toEqual(["print('done')"]);
    expect(prompts[1]).toContain("start from a fresh short strategy");
    expect(prompts[1]).toContain("source was only imports or was pathologically repetitive");
    expect(prompts[1]).toContain("Name a materially different strategy in the summary");
    expect(prompts[4]).toContain("programs: 4");
  });
});

describe("AgentLoop XLSX continuation selection", () => {
  it("does not revive partial progress after a later complete scan", () => {
    const partial = {
      ...completed,
      stdout: "VAULT_PROGRESS_DONE=5\nVAULT_PROGRESS_TOTAL=10\nVAULT_PROGRESS_COMPLETE=0\n",
    };
    const complete = {
      ...completed,
      stdout: completeXlsx("XLSX_MATCHES=100", 10),
    };

    expect(progressContinuationResponse([partial, complete])).toBeUndefined();
  });
});

describe("AgentLoop resumable XLSX execution", () => {
  it("repeats identical code only while verified progress advances", async () => {
    const source = "print('resume checkpoint')";
    const partial = (done: number) => ({
      ...completed,
      source,
      stdout: `VAULT_PROGRESS_DONE=${done}\nVAULT_PROGRESS_TOTAL=3\nVAULT_PROGRESS_COMPLETE=0\n`,
    });
    const final = { ...completed, source, stdout: completeXlsx("XLSX_MATCHES=30", 3) };
    const calls: string[] = [];
    const result = await new AgentLoop(
      inference(
        [execute(source, "Start"), execute(source, "Continue"), execute(source, "Finish")],
        [],
      ),
      executor([partial(1), partial(2), final], calls),
    ).run({
      task: "Inspect every .xlsx file and print XLSX_MATCHES=<count>.",
      modelId: "test-model",
    });

    expect(calls).toEqual([source, source, source]);
    expect(result.response).toBe("XLSX_MATCHES=30");
  });

  it("returns a continuation question after the bounded execution allowance", async () => {
    const decisions: AgentDecision[] = [];
    const results: AgentExecutionResult[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const source = `print(${index})`;
      decisions.push(execute(source, "Process a batch"));
      results.push({
        ...completed,
        source,
        stdout: `VAULT_PROGRESS_DONE=${index}\nVAULT_PROGRESS_TOTAL=10\nVAULT_PROGRESS_COMPLETE=0\n`,
      });
    }
    const result = await new AgentLoop(inference(decisions, []), executor(results, [])).run({
      task: "Inspect every .xlsx file and print XLSX_MATCHES=<count>.",
      modelId: "test-model",
    });

    expect(result.response).toContain("Processed 6 of 10 items.");
    expect(result.response).toContain("Do you want to continue?");
  });
});
