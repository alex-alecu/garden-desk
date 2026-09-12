import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "obligations-base",
    agentId: "contract-obligations",
    files: {
      "agreement.docx":
        "Signed services agreement\nCustomer pays EUR 1200 each month.\nInvoices are payable within 30 days of receipt.\nEither party must give 45 days notice of non-renewal.",
    },
    request: "Extract the stated duties. Report monthlyFee, currency, paymentDays, and noticeDays.",
    expected: { monthlyFee: 1200, currency: "EUR", paymentDays: 30, noticeDays: 45 },
    sources: ["agreement.docx"],
  },
  {
    id: "obligations-amendment",
    agentId: "contract-obligations",
    command: "obligations",
    files: {
      "agreement.docx": "Signed agreement\nMonthly fee: EUR 1200. Notice period: 45 days.",
      "amendment.pdf":
        "Signed amendment dated 2026-06-01\nMonthly fee changes to EUR 1400 from 2026-07-01.\nThe notice period remains unchanged.",
      "draft.docx":
        "UNSIGNED DRAFT\nProposed monthly fee: EUR 2100. Proposed notice period: 15 days.",
    },
    request:
      "Compare the stated terms in the signed files and the unsigned proposal. Report baseMonthlyFee, amendedMonthlyFee, amendmentEffectiveDate, unchangedNoticeDays, and draftMonthlyFee. Do not decide legal validity.",
    expected: {
      baseMonthlyFee: 1200,
      amendedMonthlyFee: 1400,
      amendmentEffectiveDate: "2026-07-01",
      unchangedNoticeDays: 45,
      draftMonthlyFee: 2100,
    },
    sources: ["agreement.docx", "amendment.pdf", "draft.docx"],
  },
];
