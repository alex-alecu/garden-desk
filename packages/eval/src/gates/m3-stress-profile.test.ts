import { describe, expect, it } from "vitest";
import { SCALED_WORKLOAD_PLAN } from "../stress/scaled-profile.js";

describe("M3 scaled document workload", () => {
  it("bounds workbook rows per file and folder totals", () => {
    expect(SCALED_WORKLOAD_PLAN.workbook).toMatchObject({ files: 1, rowsPerFile: 1_000_000 });
    expect(
      SCALED_WORKLOAD_PLAN.xlsxFolder.files * SCALED_WORKLOAD_PLAN.xlsxFolder.rowsPerFile,
    ).toBe(10_000_000);
    expect(SCALED_WORKLOAD_PLAN.xlsxFolder.files).toBe(50);
  });

  it("keeps the mixed folder at fifty files and ten million XLSX rows", () => {
    const { xlsx, docx } = SCALED_WORKLOAD_PLAN.mixedFolder;
    expect(xlsx.files + docx.files).toBe(50);
    expect(xlsx.files * xlsx.rowsPerFile).toBe(10_000_000);
  });
});
