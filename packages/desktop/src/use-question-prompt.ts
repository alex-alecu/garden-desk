import type { AgentQuestion, AgentQuestionRequest } from "@gardendesk/shared";
import { useMemo, useState } from "react";
import {
  applyCustom,
  clampPage,
  goToPage,
  initialAnswerState,
  isLastPage,
  type QuestionAnswerState,
  skipAnswer,
  submittedAnswers,
  toggleOption,
} from "./question-answers.js";

const RECOMMENDED_SUFFIX = "(Recommended)";

export interface DisplayOption {
  label: string;
  description: string;
  recommended: boolean;
}

function splitRecommended(label: string): { label: string; recommended: boolean } {
  if (label.endsWith(RECOMMENDED_SUFFIX)) {
    return { label: label.slice(0, -RECOMMENDED_SUFFIX.length).trim(), recommended: true };
  }
  return { label, recommended: false };
}

function displayOptions(question: AgentQuestion): DisplayOption[] {
  return question.options.map((option) => {
    const split = splitRecommended(option.label);
    return { label: split.label, description: option.description, recommended: split.recommended };
  });
}

/** The question with recommended-suffixes stripped, so selection stores the same label the user sees. */
function displayQuestionFrom(question: AgentQuestion, options: DisplayOption[]): AgentQuestion {
  return {
    ...question,
    options: options.map((option) => ({ label: option.label, description: option.description })),
  };
}

export interface QuestionPromptController {
  page: number;
  total: number;
  last: boolean;
  question: AgentQuestion;
  options: DisplayOption[];
  selected: string[];
  custom: string;
  editing: boolean;
  goToPage(next: number): void;
  advance(): void;
  skip(): void;
  selectOption(label: string): void;
  setCustom(value: string): void;
  startEditing(): void;
  stopEditing(): void;
  dismiss(): void;
}

/**
 * Owns paging and selection state for one question request. The custom-answer label shown to the
 * user is the display label; selection stores that same label, so what the user sees is exactly
 * what is submitted. Kept as a hook so the picker component stays presentation-only.
 */
export function useQuestionPrompt(
  request: AgentQuestionRequest,
  onAnswer: (questionId: string, answers: string[][]) => void,
  onDismiss: (questionId: string) => void,
): QuestionPromptController {
  const questions = request.questions;
  const total = questions.length;
  const [state, setState] = useState<QuestionAnswerState>(() => initialAnswerState(questions));
  const [editing, setEditing] = useState(false);
  const page = clampPage(state, total);
  const question = questions[page] as AgentQuestion;
  const last = isLastPage(state, total);
  const options = useMemo<DisplayOption[]>(() => displayOptions(question), [question]);
  const displayQuestion = useMemo<AgentQuestion>(
    () => displayQuestionFrom(question, options),
    [question, options],
  );
  return {
    page,
    total,
    last,
    question,
    options,
    selected: state.selected[page] ?? [],
    custom: state.custom[page] ?? "",
    editing,
    goToPage: (next) => {
      setEditing(false);
      setState((current) => goToPage(current, next, total));
    },
    advance: () => {
      setEditing(false);
      if (last) onAnswer(request.id, submittedAnswers(state));
      else setState((current) => goToPage(current, page + 1, total));
    },
    skip: () => {
      setEditing(false);
      const skipped = skipAnswer(state, page);
      if (last) onAnswer(request.id, submittedAnswers(skipped));
      else setState(goToPage(skipped, page + 1, total));
    },
    selectOption: (label) =>
      setState((current) => toggleOption(current, displayQuestion, page, label)),
    setCustom: (value) => setState((current) => applyCustom(current, displayQuestion, page, value)),
    startEditing: () => setEditing(true),
    stopEditing: () => setEditing(false),
    dismiss: () => onDismiss(request.id),
  };
}
