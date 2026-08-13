import type { AgentQuestion } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  applyCustom,
  clampPage,
  goToPage,
  initialAnswerState,
  isLastPage,
  skipAnswer,
  submittedAnswers,
  toggleOption,
} from "./question-answers.js";

const single: AgentQuestion = {
  header: "Direction",
  question: "Which output?",
  options: [
    { label: "Summary", description: "Short." },
    { label: "Full", description: "Long." },
  ],
};

const multi: AgentQuestion = { ...single, multiple: true };

describe("question answer selection", () => {
  it("replaces the selection for a single-select question", () => {
    let state = initialAnswerState([single]);
    state = toggleOption(state, single, 0, "Summary");
    state = toggleOption(state, single, 0, "Full");
    expect(submittedAnswers(state)).toEqual([["Full"]]);
  });

  it("clears a single-select option when it is toggled off", () => {
    let state = initialAnswerState([single]);
    state = toggleOption(state, single, 0, "Summary");
    state = toggleOption(state, single, 0, "Summary");
    expect(submittedAnswers(state)).toEqual([[]]);
  });

  it("accumulates selections for a multi-select question", () => {
    let state = initialAnswerState([multi]);
    state = toggleOption(state, multi, 0, "Summary");
    state = toggleOption(state, multi, 0, "Full");
    expect(submittedAnswers(state)).toEqual([["Summary", "Full"]]);
  });

  it("replaces a prior custom answer instead of stacking it", () => {
    let state = initialAnswerState([single]);
    state = applyCustom(state, single, 0, "First");
    state = applyCustom(state, single, 0, "Second");
    expect(submittedAnswers(state)).toEqual([["Second"]]);
  });

  it("keeps chosen options and adds a custom answer for multi-select", () => {
    let state = initialAnswerState([multi]);
    state = toggleOption(state, multi, 0, "Summary");
    state = applyCustom(state, multi, 0, "Extra");
    expect(submittedAnswers(state)).toEqual([["Summary", "Extra"]]);
  });

  it("removes the custom answer when the text is cleared", () => {
    let state = initialAnswerState([single]);
    state = applyCustom(state, single, 0, "Typed");
    state = applyCustom(state, single, 0, "   ");
    expect(submittedAnswers(state)).toEqual([[]]);
  });
});

describe("question paging", () => {
  const pair = [single, multi];

  it("clamps paging within the question range", () => {
    const state = goToPage(initialAnswerState(pair), 9, pair.length);
    expect(clampPage(state, pair.length)).toBe(1);
    expect(isLastPage(state, pair.length)).toBe(true);
  });

  it("submits empty answers for questions left unanswered", () => {
    let state = initialAnswerState(pair);
    state = toggleOption(state, single, 0, "Summary");
    expect(submittedAnswers(state)).toEqual([["Summary"], []]);
  });

  it("clears a tentative answer when the question is skipped", () => {
    let state = initialAnswerState(pair);
    state = toggleOption(state, single, 0, "Summary");
    state = skipAnswer(state, 0);
    expect(submittedAnswers(state)).toEqual([[], []]);
  });
});
