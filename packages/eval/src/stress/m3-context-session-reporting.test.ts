import { describe, expect, it } from "vitest";
import {
  anchoredSummaryFromTracePrompt,
  contextReportFailure,
} from "./m3-context-session-reporting.js";

const HEADING = "Anchored summary of earlier turns:\n";

function userPrompt(summary: string): string {
  return JSON.stringify([{ role: "user", text: `${HEADING}${summary}\nOlder execution summary:` }]);
}

describe("M3 context-session trace evidence", () => {
  it("detects an anchor in decoded user-message text", () => {
    expect(anchoredSummaryFromTracePrompt(userPrompt("First summary."))).toBe("First summary.");
  });

  it("counts three distinct decoded anchors", () => {
    const anchors = ["First summary.", "Second summary.", "Third summary."]
      .map(userPrompt)
      .flatMap((prompt) => {
        const summary = anchoredSummaryFromTracePrompt(prompt);
        return summary === undefined ? [] : [summary];
      });

    expect(new Set(anchors).size).toBe(3);
  });

  it("decodes escaped canonical JSON before anchor inspection", () => {
    const prompt = userPrompt("Escaped summary.");

    expect(prompt).not.toContain(HEADING);
    expect(anchoredSummaryFromTracePrompt(prompt)).toBe("Escaped summary.");
  });

  it("rejects malformed trace JSON", () => {
    expect(() => anchoredSummaryFromTracePrompt("[{")).toThrow();
  });

  it("treats an empty zero-turn trace prompt as no anchor", () => {
    expect(anchoredSummaryFromTracePrompt("")).toBeUndefined();
  });

  it("rejects a trace message with an invalid shape", () => {
    expect(() => anchoredSummaryFromTracePrompt(JSON.stringify([{ role: "user" }]))).toThrow();
  });

  it("returns no summary when valid messages have no anchor", () => {
    expect(
      anchoredSummaryFromTracePrompt(JSON.stringify([{ role: "user", text: "No anchor." }])),
    ).toBe(undefined);
  });

  it("does not count system or assistant text", () => {
    const prompt = JSON.stringify([
      { role: "system", text: `${HEADING}System summary.` },
      { role: "assistant", text: `${HEADING}Assistant summary.` },
    ]);

    expect(anchoredSummaryFromTracePrompt(prompt)).toBe(undefined);
  });
});

describe("M3 context-session report classification", () => {
  it("classifies an allocated-context mismatch as a product hard-check failure", () => {
    expect(
      contextReportFailure({
        allocatedContexts: [32_768],
        contextTokens: 65_536,
        distinctAnchors: 3,
        missingTerms: [],
        qualityCandidates: [],
        qualityOnly: false,
        turnStates: ["succeeded"],
      }),
    ).toEqual({
      failureClass: "product_failure",
      evidenceReference: "report.allocatedContexts",
    });
  });
});
