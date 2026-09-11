import type { SpecialistCase } from "./specialist-fixtures.js";

export const cases: SpecialistCase[] = [
  {
    id: "chronology-split",
    agentId: "matter-chronology",
    files: {
      "correspondence.docx":
        "2026-01-05: Buyer sent purchase order PO-17.\n2026-01-09: Buyer disputed the delivered quantity.",
      "delivery.pdf": "Delivery record\n2026-01-07: Seller delivered purchase order PO-17.",
    },
    request:
      "Build the matter timeline. Report eventDates in chronological order and purchaseOrder.",
    expected: { eventDates: ["2026-01-05", "2026-01-07", "2026-01-09"], purchaseOrder: "PO-17" },
    sources: ["correspondence.docx", "delivery.pdf"],
  },
  {
    id: "chronology-conflict",
    agentId: "matter-chronology",
    files: {
      "letter.docx":
        "The delivery occurred on 2026-02-03.\nUndated note: the buyer requested a replacement.",
      "receipt.pdf": "Delivery receipt\nThe delivery occurred on 2026-02-05.",
    },
    request:
      "Report disputedDeliveryDates (sorted), undatedEventCount, and replacementRequestDate (null if not stated). Do not resolve the conflict.",
    expected: {
      disputedDeliveryDates: ["2026-02-03", "2026-02-05"],
      undatedEventCount: 1,
      replacementRequestDate: null,
    },
    sources: ["letter.docx", "receipt.pdf"],
  },
];
