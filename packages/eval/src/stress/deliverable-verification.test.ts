import { describe, expect, it } from "vitest";
import { missingFactAlternatives } from "./deliverable-verification.js";

describe("deliverable fact alternatives", () => {
  it("accepts one exact visible rendering from each label-value group", () => {
    expect(
      missingFactAlternatives("MATCHING_INVOICES: 8\nINVOICE_TOTAL: 20012.0", [
        ["MATCHING_INVOICES=8", "MATCHING_INVOICES: 8"],
        ["INVOICE_TOTAL=20012", "INVOICE_TOTAL: 20012.0"],
      ]),
    ).toEqual([]);
  });

  it("reports a group when no exact rendering exists", () => {
    expect(missingFactAlternatives("MATCHING_INVOICES: 7", [["MATCHING_INVOICES=8"]])).toEqual([
      "MATCHING_INVOICES=8",
    ]);
  });
});
