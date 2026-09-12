import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "expenses-duplicates",
    agentId: "invoice-expense-review",
    files: {
      "claims.xlsx": {
        sheet: "Claims",
        rows: [
          ["Claim", "Invoice", "Amount", "Currency"],
          ["C1", "R-5", 72, "EUR"],
          ["C2", "R-5", 72, "EUR"],
        ],
      },
      "receipt.pdf": "Invoice R-5\nQuantity 3 at EUR 20 each. Tax EUR 10. Stated total EUR 72.",
    },
    request:
      "Check arithmetic and possible duplicate claims. Report duplicateInvoiceId, expectedReceiptTotal, statedReceiptTotal, and receiptOverstatement.",
    expected: {
      duplicateInvoiceId: "R-5",
      expectedReceiptTotal: 70,
      statedReceiptTotal: 72,
      receiptOverstatement: 2,
    },
    sources: ["claims.xlsx", "receipt.pdf"],
  },
  {
    id: "expenses-policy",
    agentId: "invoice-expense-review",
    command: "expenses",
    files: {
      "policy.docx":
        "Expense rules\nEach meal claim must not exceed EUR 40.\nEvery claim requires a receipt.",
      "claims.csv":
        "claim,category,amount,currency,receipt\nM1,meal,55,EUR,meal.pdf\nT1,taxi,25,EUR,\n",
      "meal.pdf": "Meal receipt\nTotal: EUR 55. Claim: M1.",
    },
    request:
      "Apply only the supplied policy. Report overLimitClaimId, excessAmount, and missingReceiptClaimId.",
    expected: { overLimitClaimId: "M1", excessAmount: 15, missingReceiptClaimId: "T1" },
    sources: ["policy.docx", "claims.csv", "meal.pdf"],
  },
];
