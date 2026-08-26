import { ChatMessageSchema } from "@vault/shared";
import type { M3EvidenceReference, M3QualityCandidate } from "./m3-evidence-classification.js";

const ANCHORED_SUMMARY_HEADING = "Anchored summary of earlier turns:\n";
const SUMMARY_ENDINGS = [
  "\nOlder execution summary:",
  "\nNewest unsuperseded failed execution:",
  "\nRecent conversation:",
];

function summaryFrom(text: string, start: number): string {
  const contentStart = start + ANCHORED_SUMMARY_HEADING.length;
  const endings = SUMMARY_ENDINGS.map((marker) => text.indexOf(marker, contentStart)).filter(
    (index) => index !== -1,
  );
  const end = endings.length === 0 ? text.length : Math.min(...endings);
  return text.slice(contentStart, end).trim();
}

export function anchoredSummaryFromTracePrompt(prompt: string): string | undefined {
  if (prompt.length === 0) return undefined;
  const messages = ChatMessageSchema.array().parse(JSON.parse(prompt));
  const message = messages.find(
    (item) => item.role === "user" && item.text.includes(ANCHORED_SUMMARY_HEADING),
  );
  if (message === undefined || message.role !== "user") return undefined;
  return summaryFrom(message.text, message.text.indexOf(ANCHORED_SUMMARY_HEADING));
}

function evidenceFailure(
  failureClass: "product_failure" | "runtime_failure",
  evidenceReference: M3EvidenceReference,
) {
  return { failureClass, evidenceReference };
}

export function contextReportFailure(input: {
  allocatedContexts: readonly number[];
  contextTokens: number;
  distinctAnchors: number;
  missingTerms: readonly string[];
  qualityCandidates: readonly M3QualityCandidate[];
  qualityOnly: boolean;
  turnStates: readonly string[];
}) {
  const {
    allocatedContexts,
    contextTokens,
    distinctAnchors,
    missingTerms,
    qualityCandidates,
    qualityOnly,
    turnStates,
  } = input;
  if (!turnStates.every((state) => state === "succeeded")) {
    if (qualityOnly && qualityCandidates.length > 0) {
      return evidenceFailure("product_failure", "report.qualityCandidates");
    }
    return evidenceFailure("runtime_failure", "report.turns");
  }
  if (allocatedContexts.some((value) => value !== contextTokens)) {
    return evidenceFailure("product_failure", "report.allocatedContexts");
  }
  if (missingTerms.length > 0) {
    return evidenceFailure("product_failure", "report.missingTerms");
  }
  if (distinctAnchors < 3) {
    return evidenceFailure("product_failure", "report.distinctAnchors");
  }
  return undefined;
}
