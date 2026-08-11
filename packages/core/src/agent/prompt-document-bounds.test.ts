import { describe, expect, it } from "vitest";
import { newProgress } from "./loop-turn.js";
import { generationInput } from "./prompt.js";
import { generationSchema } from "./prompt-generation-schema.js";

describe("document prompt bounds", () => {
  it("fits a three-format request at the certified 8K floor", () => {
    const task = [
      "Review XLSX invoices, DOCX meeting notes, and one policy PDF.",
      "Create polished reports labeled MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES.",
      "Required deliverables: scaled-report.pdf, scaled-report.docx, scaled-report.xlsx.",
    ].join(" ");
    const request = generationInput({ task, modelId: "test-model" }, newProgress(), false, {
      contextTokens: 8_192,
    });
    expect(Math.ceil(JSON.stringify(request).length / 4)).toBeLessThanOrEqual(4_096);
  });

  it("keeps malformed progress repairs to 64 source lines", () => {
    const progress = newProgress();
    progress.lastRejectedProgramReason = "invalid";
    const schema = generationSchema(
      { task: "Search every workbook and return a complete table.", modelId: "test-model" },
      progress,
      false,
      undefined,
    );
    expect(JSON.stringify(schema)).toContain('"maxItems":64');
  });
});
