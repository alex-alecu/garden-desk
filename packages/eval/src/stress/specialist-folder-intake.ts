import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "intake-mixed",
    agentId: "folder-intake",
    files: {
      "register.xlsx": {
        sheet: "Invoices",
        rows: [
          ["Invoice", "Amount", "Currency"],
          ["A-17", 120, "EUR"],
        ],
      },
      "terms.docx": "Payment terms\nPayment is due within 30 days.",
      "receipt.pdf": "Receipt R-17\nReceived EUR 120 for invoice A-17.",
    },
    request:
      "Inspect this mixed folder before batch work. Report fileCount, spreadsheetSheet, spreadsheetHeaders (in column order), and pdfPageCount.",
    expected: {
      fileCount: 3,
      spreadsheetSheet: "Invoices",
      spreadsheetHeaders: ["Invoice", "Amount", "Currency"],
      pdfPageCount: 1,
    },
    sources: ["register.xlsx", "terms.docx", "receipt.pdf"],
  },
  {
    id: "intake-live-header",
    agentId: "folder-intake",
    files: {
      "register.xlsx": {
        sheet: "Export",
        rows: [["Monthly export"], [], ["Reference", "Net", "Tax"], ["B-2", 100, 19]],
      },
    },
    addedAfterGrant: { "late.csv": "invoice,gross,currency\nB-3,75,EUR\n" },
    request:
      "Inspect all files currently in this folder. Report fileNames (sorted), workbookHeaderRow (one-based), and csvHeaders (in column order).",
    expected: {
      fileNames: ["late.csv", "register.xlsx"],
      workbookHeaderRow: 3,
      csvHeaders: ["invoice", "gross", "currency"],
    },
    sources: ["register.xlsx", "late.csv"],
  },
];
