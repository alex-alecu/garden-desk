import { describe, expect, it } from "vitest";
import { SCALED_WORKLOAD_PLAN } from "../stress/scaled-profile.js";

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
