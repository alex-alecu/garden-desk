import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "brief-board",
    agentId: "evidence-brief",
    files: {
      "minutes.docx":
        "Board decision dated 2026-08-10\nApprove EUR 5000 for project Cedar. Owner: Maya. Deadline: 2026-09-30.",
      "ledger.xlsx": {
        sheet: "Spend",
        rows: [
          ["Project", "Spent", "Currency"],
          ["Cedar", 3200, "EUR"],
        ],
      },
      "status.pdf": "Project Cedar status\nOne supplier quote remains pending.",
    },
    request:
      "Build the evidence brief for project Cedar. Report approvedBudget, spent, remainingBudget, owner, deadline, and pendingQuoteCount.",
    expected: {
      approvedBudget: 5000,
      spent: 3200,
      remainingBudget: 1800,
      owner: "Maya",
      deadline: "2026-09-30",
      pendingQuoteCount: 1,
    },
    sources: ["minutes.docx", "ledger.xlsx", "status.pdf"],
  },
  {
    id: "brief-conflict",
    agentId: "evidence-brief",
    command: "brief",
    files: {
      "proposal.docx":
        "Project Elm\nProposed annual fee: EUR 1800. Approval has not been recorded.",
      "schedule.pdf":
        "Project Elm fee schedule\nAnnual fee: EUR 2100. No payment account is specified.",
    },
    request:
      "Prepare a brief that preserves the fee conflict and missing facts. Report statedAnnualFees (sorted), approvalRecorded (boolean), and paymentAccount (null if absent).",
    expected: { statedAnnualFees: [1800, 2100], approvalRecorded: false, paymentAccount: null },
    sources: ["proposal.docx", "schedule.pdf"],
  },
];
