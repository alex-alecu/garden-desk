import { describe, expect, it } from "vitest";
import {
  hasExactVisibleFact,
  missingFactAlternatives,
  missingVisibleLabelValues,
  presentForbiddenPatterns,
} from "./deliverable-verification.js";

describe("exact visible facts", () => {
  it("accepts an exact fact between normal punctuation and whitespace", () => {
    expect(hasExactVisibleFact("Summary: POLICY_PAGES=100. Complete", "POLICY_PAGES=100")).toBe(
      true,
    );
  });

  it("rejects longer labels and values", () => {
    expect(hasExactVisibleFact("POLICY_PAGES=1000", "POLICY_PAGES=100")).toBe(false);
    expect(hasExactVisibleFact("TOTAL_POLICY_PAGES=100", "POLICY_PAGES=100")).toBe(false);
  });

  it("rejects a decimal continuation of an expected integer", () => {
    expect(hasExactVisibleFact("INVOICE_TOTAL=20012.01", "INVOICE_TOTAL=20012")).toBe(false);
  });

  it("rejects a grouped-number continuation", () => {
    expect(hasExactVisibleFact("INVOICE_TOTAL=20012,001", "INVOICE_TOTAL=20012")).toBe(false);
  });

  it("rejects exponent continuations of an expected number", () => {
    expect(hasExactVisibleFact("INVOICE_TOTAL=20012e3", "INVOICE_TOTAL=20012")).toBe(false);
    expect(hasExactVisibleFact("INVOICE_TOTAL=20012E+3", "INVOICE_TOTAL=20012")).toBe(false);
  });

  it("rejects arithmetic continuations", () => {
    for (const continuation of ["+1", "-1", "*2", "/2", "**2", "÷2"]) {
      expect(hasExactVisibleFact(`INVOICE_TOTAL=20012${continuation}`, "INVOICE_TOTAL=20012")).toBe(
        false,
      );
    }
  });

  it("accepts sentence and closing punctuation", () => {
    for (const continuation of [" complete", ".", ", complete", "; complete", ")", "]", "}"]) {
      expect(hasExactVisibleFact(`INVOICE_TOTAL=20012${continuation}`, "INVOICE_TOTAL=20012")).toBe(
        true,
      );
    }
  });

  it("rejects astral Unicode letter and number boundaries", () => {
    expect(hasExactVisibleFact("\u{10400}POLICY_PAGES=100", "POLICY_PAGES=100")).toBe(false);
    expect(hasExactVisibleFact("POLICY_PAGES=100\u{1D7D8}", "POLICY_PAGES=100")).toBe(false);
  });
});

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

describe("forbidden deliverable patterns", () => {
  it("finds unsafe text independent of capitalization", () => {
    expect(
      presentForbiddenPatterns("APPROVE this packet.", [String.raw`\b(?:approve|deny)\b`]),
    ).toEqual([String.raw`\b(?:approve|deny)\b`]);
  });
});
