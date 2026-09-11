import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "reconciliation-partial",
    agentId: "financial-reconciliation",
    files: {
      "invoices.xlsx": {
        sheet: "Invoices",
        rows: [
          ["Invoice", "Gross", "Currency"],
          ["A", 100, "EUR"],
          ["B", 200, "EUR"],
          ["C", 50, "EUR"],
          ["D", 75, "EUR"],
        ],
      },
      "payments.csv": "invoice,amount,currency\nA,100,EUR\nB,150,EUR\nC,50,EUR\n",
    },
    request:
      "Match by invoice ID and currency. Report fullyPaidIds (sorted), partialInvoiceId, partialBalance, unpaidInvoiceId, and totalOutstanding.",
    expected: {
      fullyPaidIds: ["A", "C"],
      partialInvoiceId: "B",
      partialBalance: 50,
      unpaidInvoiceId: "D",
      totalOutstanding: 125,
    },
    sources: ["invoices.xlsx", "payments.csv"],
  },
  {
    id: "reconciliation-ambiguous",
    agentId: "financial-reconciliation",
    command: "reconcile",
    files: {
      "invoices.csv": "row,invoice,amount,currency\n1,X,100,EUR\n2,Y,80,EUR\n3,Y,80,EUR\n",
      "bank.xlsx": {
        sheet: "Bank",
        rows: [
          ["Invoice", "Amount", "Currency"],
          ["X", 100, "USD"],
          ["Y", 80, "EUR"],
        ],
      },
    },
    request:
      "Match only when invoice ID and currency agree and the invoice row is unique. Report currencyMismatchId, duplicateInvoiceId, and unambiguousMatchCount.",
    expected: { currencyMismatchId: "X", duplicateInvoiceId: "Y", unambiguousMatchCount: 0 },
    sources: ["invoices.csv", "bank.xlsx"],
  },
];
