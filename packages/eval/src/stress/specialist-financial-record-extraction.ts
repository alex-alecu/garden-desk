import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "extraction-currencies",
    agentId: "financial-record-extraction",
    files: {
      "invoice-eur.pdf":
        "Invoice E-10\nIssue date: 2026-08-01. Currency: EUR. Net: 100. Tax: 19. Total: 119.",
      "invoice-usd.pdf":
        "Invoice U-20\nIssue date: 2026-08-02. Currency: USD. Net: 100. Tax: 0. Total: 100.",
    },
    request:
      "Extract both invoice records without currency conversion. Report invoiceIds (sorted), eurGrossTotal, and usdGrossTotal.",
    expected: { invoiceIds: ["E-10", "U-20"], eurGrossTotal: 119, usdGrossTotal: 100 },
    sources: ["invoice-eur.pdf", "invoice-usd.pdf"],
  },
  {
    id: "extraction-credit",
    agentId: "financial-record-extraction",
    command: "extract",
    files: {
      "ledger.xlsx": {
        sheet: "Export",
        rows: [
          ["August transactions"],
          ["ID", "Type", "Gross", "Currency"],
          ["I-11", "Invoice", 240, "EUR"],
          ["C-11", "Credit", -40, "EUR"],
        ],
      },
    },
    request:
      "Extract the invoice and credit rows, preserving their signs. Report recordCount, creditId, creditGross, and netGrossTotal.",
    expected: { recordCount: 2, creditId: "C-11", creditGross: -40, netGrossTotal: 200 },
    sources: ["ledger.xlsx"],
  },
];
