import { describe, expect, it } from "vitest";
import { missingFactAlternatives, missingVisibleLabelValues } from "./deliverable-verification.js";

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

describe("visible label values", () => {
  const groups = [
    { label: "INVOICE_TOTAL", values: ["20012", "20012.0"] },
    { label: "MEETING_NOTES", values: ["24"] },
  ];

  it("accepts styled labels with nearby prose values", () => {
    expect(
      missingVisibleLabelValues(
        "INVOICE_TOTAL\nTotal amount of matching invoices: 20012.0\nMEETING_NOTES\nCount: 24",
        groups,
      ),
    ).toEqual([]);
  });

  it("rejects a label whose correct value is not nearby", () => {
    expect(
      missingVisibleLabelValues("INVOICE_TOTAL\nUnknown\nMEETING_NOTES\nCount: 24", groups),
    ).toEqual(["INVOICE_TOTAL=20012|20012.0"]);
  });
});
