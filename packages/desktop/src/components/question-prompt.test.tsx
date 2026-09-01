import { AgentQuestionRequestSchema } from "@gardendesk/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionPrompt } from "./question-prompt.js";

const request = AgentQuestionRequestSchema.parse({
  id: "55555555-5555-4555-8555-555555555555",
  runId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-08-12T10:00:00.000Z",
  questions: [
    {
      header: "Direction",
      question: "What should this lead to once you answer?",
      options: [
        { label: "UI check only (Recommended)", description: "We confirm the picker renders." },
        {
          label: "Plan real work",
          description: "I use your answers to plan a full implementation.",
        },
      ],
    },
    {
      header: "Scope",
      question: "How wide should the change be?",
      options: [
        { label: "Narrow", description: "Only the picker." },
        { label: "Broad", description: "The whole flow." },
      ],
    },
  ],
});

function render() {
  return renderToStaticMarkup(
    <QuestionPrompt
      onAnswer={() => undefined}
      onDismiss={() => undefined}
      onStop={() => undefined}
      request={request}
      stopping={false}
    />,
  );
}

describe("QuestionPrompt", () => {
  it("shows the first question, its paging position, and a Stop control", () => {
    const markup = render();
    expect(markup).toContain("What should this lead to once you answer?");
    expect(markup).toContain("1 of 2");
    expect(markup).toContain(">Stop<");
    expect(markup).toContain(">Skip<");
  });

  it("marks the recommended option with a badge and strips its label suffix", () => {
    const markup = render();
    expect(markup).toContain("UI check only");
    expect(markup).not.toContain("(Recommended)");
    expect(markup).toContain(">Recommended<");
  });

  it("exposes each option description as a hover title", () => {
    const markup = render();
    expect(markup).toContain('title="We confirm the picker renders."');
  });
});
