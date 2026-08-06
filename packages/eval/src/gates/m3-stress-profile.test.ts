import { describe, expect, it } from "vitest";
import { SCALED_WORKLOAD_PLAN } from "../stress/scaled-profile.js";
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
});

describe("M3 XLSX row-filter regression workload", () => {
  it("keeps ten 100-row workbooks in ten subfolders", () => {
    expect(XLSX_ROW_FILTER_PLAN).toEqual({ files: 10, rowsPerFile: 100, subfolders: 10 });
  });
});
