import { describe, expect, it } from "vitest";
import { parseXlsxProgress, stripXlsxProgress, xlsxProgressAdvanced } from "./xlsx-progress.js";

describe("XLSX progress evidence", () => {
  it("parses valid progress and removes only reserved lines", () => {
    const stdout = [
      "XLSX_MATCHES=10",
      "VAULT_XLSX_FILES_DONE=2",
      "VAULT_XLSX_FILES_TOTAL=5",
      "VAULT_XLSX_COMPLETE=0",
    ].join("\n");
    expect(parseXlsxProgress(stdout)).toEqual({ filesDone: 2, filesTotal: 5, complete: false });
    expect(stripXlsxProgress(stdout)).toBe("XLSX_MATCHES=10");
  });

  it("accepts exact whitespace-delimited markers on one line", () => {
    const stdout = [
      "No salary transactions found.",
      "VAULT_XLSX_FILES_DONE=36 VAULT_XLSX_FILES_TOTAL=36 VAULT_XLSX_COMPLETE=1",
    ].join("\n");
    expect(parseXlsxProgress(stdout)).toEqual({ filesDone: 36, filesTotal: 36, complete: true });
    expect(stripXlsxProgress(stdout)).toBe("No salary transactions found.");
  });

  it.each([
    "VAULT_XLSX_FILES_DONE=6\nVAULT_XLSX_FILES_TOTAL=5\nVAULT_XLSX_COMPLETE=0",
    "VAULT_XLSX_FILES_DONE=5\nVAULT_XLSX_FILES_TOTAL=5\nVAULT_XLSX_COMPLETE=0",
    "VAULT_XLSX_FILES_DONE=x\nVAULT_XLSX_FILES_TOTAL=5\nVAULT_XLSX_COMPLETE=0",
  ])("rejects malformed or contradictory evidence", (stdout) => {
    expect(parseXlsxProgress(stdout)).toBeUndefined();
  });

  it("advances only within the same corpus size", () => {
    const first = { filesDone: 1, filesTotal: 5, complete: false };
    expect(xlsxProgressAdvanced(first, { ...first, filesDone: 2 })).toBe(true);
    expect(xlsxProgressAdvanced(first, first)).toBe(false);
    expect(xlsxProgressAdvanced(first, { filesDone: 2, filesTotal: 6, complete: false })).toBe(
      false,
    );
  });
});
