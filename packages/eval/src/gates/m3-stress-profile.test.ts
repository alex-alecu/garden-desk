import { describe, expect, it } from "vitest";
import {
  CONTEXT_COMPACTION_PLAN,
  OVERSIZED_TABLE_PLAN,
  REPEATED_COMPACTION_PLAN,
} from "../stress/context-compaction-fixture.js";
import { SCALED_CASES, SCALED_WORKLOAD_PLAN } from "../stress/scaled-profile.js";
import {
  SMALL_CONCURRENT_CASES,
  SMALL_FOCUSED_REPORT_CASES,
  SMALL_SEQUENTIAL_CASES,
} from "../stress/small-profile.js";
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
});

describe("M3 XLSX row-filter regression workload", () => {
  it("keeps ten 100-row workbooks in ten subfolders", () => {
    expect(XLSX_ROW_FILTER_PLAN).toEqual({ files: 10, rowsPerFile: 100, subfolders: 10 });
  });
});

describe("M3 context turnover regressions", () => {
  it("keeps enough records to exceed the bounded observation stream", () => {
    expect(CONTEXT_COMPACTION_PLAN).toEqual({ records: 6_000, shards: 3 });
    expect(REPEATED_COMPACTION_PLAN).toEqual({ stages: 3, recordsPerStage: 2_000 });
  });

  it("keeps the complete table too large for the response contract", () => {
    expect(OVERSIZED_TABLE_PLAN).toEqual({ rows: 2_000, workbooks: 4 });
  });
});

describe("M3 small stress sweep", () => {
  it("keeps stochastic management reports focused while sweeping named regressions", () => {
    expect(SMALL_FOCUSED_REPORT_CASES).toEqual([
      "pdf-report",
      "word-report",
      "excel-report",
      "large-corpus-continuation",
    ]);
    expect(SMALL_SEQUENTIAL_CASES).toEqual(
      expect.arrayContaining([
        "context-compaction",
        "repeated-context-compaction",
        "oversized-table-result",
        "excel-row-filter",
        "terminal-discovery",
      ]),
    );
    expect(SMALL_CONCURRENT_CASES).toEqual([
      "excel-row-filter",
      "terminal-discovery",
      "invalid-document",
    ]);
  });
});
