import type { KeyboardEvent } from "react";

function arrowStep(key: string): number {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return 0;
}

function moveOptionFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.target instanceof HTMLTextAreaElement) return;
  const step = arrowStep(event.key);
  if (step === 0) return;
  const options = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      ".question-option-input, button.question-custom",
    ),
  ];
  const current = options.findIndex((option) => option.contains(event.target as Node));
  if (current < 0) return;
  event.preventDefault();
  options[Math.max(0, Math.min(options.length - 1, current + step))]?.focus();
}

function selectFocusedOption(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false;
  }
  if (!(event.target instanceof HTMLInputElement)) return false;
  if (!event.target.classList.contains("question-option-input")) return false;
  event.preventDefault();
  event.target.click();
  return true;
}

export function handleQuestionKey(
  event: KeyboardEvent<HTMLElement>,
  dismiss: () => void,
  advance: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();
  } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    advance();
  } else if (!selectFocusedOption(event)) moveOptionFocus(event);
}
