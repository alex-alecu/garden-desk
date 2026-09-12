import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "comparison-clauses",
    agentId: "document-comparison",
    files: {
      "v1.docx":
        "Service terms\nMonthly fee: EUR 900.\nSupport includes weekends.\nPayment due within 20 days.",
      "v2.docx": "Service terms\nMonthly fee: EUR 1100.\nPayment due within 20 days.",
    },
    request:
      "Compare v1 with v2. Report oldMonthlyFee, newMonthlyFee, weekendSupportRemoved (boolean), and unchangedPaymentDays.",
    expected: {
      oldMonthlyFee: 900,
      newMonthlyFee: 1100,
      weekendSupportRemoved: true,
      unchangedPaymentDays: 20,
    },
    sources: ["v1.docx", "v2.docx"],
  },
  {
    id: "comparison-cross-format",
    agentId: "document-comparison",
    files: {
      "approved.pdf": "Approved schedule\nItem A: EUR 100. Item B: EUR 200. Total: EUR 300.",
      "revised.xlsx": {
        sheet: "Schedule",
        rows: [
          ["Item", "EUR"],
          ["A", 100],
          ["B", 250],
          ["Total", 350],
        ],
      },
    },
    request:
      "Compare the approved schedule with the revised workbook. Report changedItem, approvedTotal, revisedTotal, and totalIncrease.",
    expected: { changedItem: "B", approvedTotal: 300, revisedTotal: 350, totalIncrease: 50 },
    sources: ["approved.pdf", "revised.xlsx"],
  },
];
