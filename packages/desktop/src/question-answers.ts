import type { AgentQuestion } from "@gardendesk/shared";

/**
 * Selection state for one multi-question request. `selected` holds the chosen option labels per
 * question; `custom` holds the per-question typed answer, which participates only when its label is
 * present in `selected`. The state is a plain value so the picker component and its tests share one
 * source of truth without touching the DOM.
 */
export interface QuestionAnswerState {
  page: number;
  selected: string[][];
  custom: string[];
}

export function initialAnswerState(questions: readonly AgentQuestion[]): QuestionAnswerState {
  return {
    page: 0,
    selected: questions.map(() => []),
    custom: questions.map(() => ""),
  };
}

export function clampPage(state: QuestionAnswerState, total: number): number {
  return Math.max(0, Math.min(total - 1, state.page));
}

export function isLastPage(state: QuestionAnswerState, total: number): boolean {
  return clampPage(state, total) >= total - 1;
}

export function goToPage(
  state: QuestionAnswerState,
  page: number,
  total: number,
): QuestionAnswerState {
  return { ...state, page: Math.max(0, Math.min(total - 1, page)) };
}

/** Toggles one option. Single-select replaces the selection; multi-select adds or removes it. */
export function toggleOption(
  state: QuestionAnswerState,
  question: AgentQuestion,
  index: number,
  label: string,
): QuestionAnswerState {
  const current = state.selected[index] ?? [];
  const next =
    question.multiple === true
      ? current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label]
      : current.includes(label)
        ? []
        : [label];
  return { ...state, selected: replaceAt(state.selected, index, next) };
}

/**
 * Applies the typed custom answer for a question. The custom value replaces any prior custom entry
 * in the selection; an empty value removes it. Single-select clears option choices so the custom
 * text becomes the sole answer.
 */
export function applyCustom(
  state: QuestionAnswerState,
  question: AgentQuestion,
  index: number,
  value: string,
): QuestionAnswerState {
  const trimmedPrevious = (state.custom[index] ?? "").trim();
  const trimmedNext = value.trim();
  const custom = replaceAt(state.custom, index, value);
  const optionLabels = new Set(question.options.map((option) => option.label));
  const withoutPrevious = (state.selected[index] ?? []).filter(
    (label) => optionLabels.has(label) || label !== trimmedPrevious,
  );
  let next: string[];
  if (trimmedNext.length === 0) {
    next = withoutPrevious;
  } else if (question.multiple === true) {
    next = withoutPrevious.includes(trimmedNext)
      ? withoutPrevious
      : [...withoutPrevious, trimmedNext];
  } else {
    next = [trimmedNext];
  }
  return { ...state, custom, selected: replaceAt(state.selected, index, next) };
}

/** The answers array submitted to Core: one label list per question, empty for skipped questions. */
export function submittedAnswers(state: QuestionAnswerState): string[][] {
  return state.selected.map((labels) => [...labels]);
}

/** Clears one question so Skip submits it as unanswered even after a tentative selection. */
export function skipAnswer(state: QuestionAnswerState, index: number): QuestionAnswerState {
  return {
    ...state,
    selected: replaceAt(state.selected, index, []),
    custom: replaceAt(state.custom, index, ""),
  };
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = [...items];
  next[index] = value;
  return next;
}
