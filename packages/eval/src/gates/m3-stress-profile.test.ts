import { describe, expect, it } from "vitest";
import { OVERSIZED_TABLE_PLAN } from "../stress/context-compaction-fixture.js";
import { SCALED_CASES, SCALED_WORKLOAD_PLAN } from "../stress/scaled-profile.js";
import { SMALL_CASE_IDS, SMALL_GATE_CASES } from "../stress/small-profile.js";
import {
  XLSX_PATH_LIST_ACCOUNTS,
  XLSX_PATH_LIST_MONTHS,
  XLSX_PATH_LIST_ROWS,
} from "../stress/xlsx-path-list-fixture.js";
import { XLSX_ROW_FILTER_PLAN } from "../stress/xlsx-row-filter-fixture.js";

describe("M3 scaled document workload", () => {
  it("keeps the Excel report at fifty files and ten million rows", () => {
    expect(
      SCALED_WORKLOAD_PLAN.excelReport.files * SCALED_WORKLOAD_PLAN.excelReport.rowsPerFile,
    ).toBe(10_000_000);
    expect(SCALED_WORKLOAD_PLAN.excelReport.files).toBe(50);
  });

  it("keeps the cross-format corpus at fifty files and ten million workbook rows", () => {
    const { xlsx, docx, pdf } = SCALED_WORKLOAD_PLAN.crossFormatReport;
    expect(xlsx.files + docx.files + pdf.files).toBe(50);
    expect(xlsx.files * xlsx.rowsPerFile).toBe(10_000_000);
  });

  it("keeps format-specific task wording scoped to each fixture", () => {
    const pdf = SCALED_CASES.find(({ id }) => id === "pdf-report");
    const xlsx = SCALED_CASES.find(({ id }) => id === "excel-report");
    expect(pdf?.task).toContain("one PDF");
    expect(pdf?.task).not.toContain("XLSX");
    expect(xlsx?.task).toContain("XLSX invoice workbooks");
    expect(xlsx?.task).not.toContain("meeting");
    expect(xlsx?.task).not.toContain("PDF");
  });

  it("requires corpus-derived exact labels in every scaled deliverable", () => {
    expect(
      SCALED_CASES.every(({ task }) =>
        task.includes(
          "In each deliverable, visibly include each requested label exactly as LABEL=value, with the value derived from the selected corpus. For each requested value, count all source items with the stated marker. For a requested total, instead sum the numeric amount values of all matching records.",
        ),
      ),
    ).toBe(true);
  });
});

describe("M3 XLSX row-filter regression workload", () => {
  it("keeps ten 100-row workbooks in ten subfolders", () => {
    expect(XLSX_ROW_FILTER_PLAN).toEqual({ files: 10, rowsPerFile: 100, subfolders: 10 });
  });
});

describe("M3 XLSX path-list regression workload", () => {
  it("keeps 36 synthetic account workbooks across 12 Romanian month folders", () => {
    expect(XLSX_PATH_LIST_MONTHS).toHaveLength(12);
    expect(XLSX_PATH_LIST_ACCOUNTS).toHaveLength(3);
    expect(XLSX_PATH_LIST_ROWS).toHaveLength(36);
  });
});

describe("M3 bounded result regressions", () => {
  it("keeps the complete table too large for the response contract", () => {
    expect(OVERSIZED_TABLE_PLAN).toEqual({ rows: 2_000, sheetsPerWorkbook: 2, workbooks: 4 });
  });
});

describe("M3 small stress sweep", () => {
  it("keeps the V1 gate small and leaves large model workloads optional", () => {
    expect(SMALL_GATE_CASES).toEqual([
      "terminal-discovery",
      "legacy-doc-read",
      "xlsx-edit",
      "docx-edit",
      "invalid-document",
    ]);
    expect(SMALL_CASE_IDS).toEqual(
      expect.arrayContaining(["oversized-table-result", "excel-chat-path-list", "word-report"]),
    );
    expect(SMALL_GATE_CASES).not.toContain("oversized-table-result");
    expect(SMALL_GATE_CASES).not.toContain("large-corpus-continuation");
    expect(SMALL_GATE_CASES).not.toContain("excel-chat-path-list");
    expect(SMALL_GATE_CASES).not.toContain("pdf-merge");
  });
});
