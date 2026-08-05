import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  executionCompletionSummary,
  normalizeGfmTable,
  validGfmTable,
  verifiedXlsxOutput,
} from "./output-contract.js";

function result(
  termination: AgentExecutionResult["termination"],
  exitCode: number,
): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/0001.py",
    source: "print('ok')",
    command: null,
    exitCode,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination,
    artifacts: [],
  };
}

describe("execution completion summary", () => {
  it("keeps successful conversation progress non-technical", () => {
    expect(executionCompletionSummary(result("completed", 0))).toBe("Finished this step.");
  });

  it("describes unsuccessful outcomes without process jargon", () => {
    expect(executionCompletionSummary(result("timeout", 124))).toBe(
      "This step took too long and stopped.",
    );
    expect(executionCompletionSummary(result("cancelled", 130))).toBe("This step was cancelled.");
    expect(executionCompletionSummary(result("crash", 1))).toBe(
      "This step could not be completed.",
    );
  });
});

it("leaves an artifact-only XLSX response to the final model response", () => {
  const execution = {
    ...result("completed", 0),
    stdout: "VAULT_XLSX_FILES_DONE=36\nVAULT_XLSX_FILES_TOTAL=36\nVAULT_XLSX_COMPLETE=1\n",
    artifacts: [
      { name: "result.xlsx", mediaType: "application/octet-stream", bytesBase64: "eA==" },
    ],
  };
  expect(verifiedXlsxOutput([execution], [])).toBeUndefined();
});

it("normalizes unescaped separators into the final GFM cell", () => {
  const table = ["| Source | Row |", "| --- | --- |", "| input.xlsx | amount |avans |"].join("\n");
  const normalized = "| Source | Row |\n| --- | --- |\n| input.xlsx | amount avans |";
  const execution = {
    ...result("completed", 0),
    stdout: `${table}\nVAULT_XLSX_FILES_DONE=1\nVAULT_XLSX_FILES_TOTAL=1\nVAULT_XLSX_COMPLETE=1\n`,
  };

  expect(validGfmTable(table)).toBe(false);
  expect(normalizeGfmTable(table)).toBe(normalized);
  expect(verifiedXlsxOutput([execution], [])).toBe(normalized);
});
