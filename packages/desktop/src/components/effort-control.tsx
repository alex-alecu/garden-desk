import type { ThinkingLevel } from "@gardendesk/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  xhigh: "Extended",
};

const EFFORT_LEVELS: ThinkingLevel[] = ["none", "medium", "xhigh"];

interface EffortControlProps {
  disabled: boolean;
  thinking: ThinkingLevel;
  onThinkingChange(level: ThinkingLevel): void;
}

function EffortMenu({
  thinking,
  onChoose,
  onClose,
}: {
  thinking: ThinkingLevel;
  onChoose(level: ThinkingLevel): void;
  onClose(): void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      aria-label="Effort"
      className="effort-menu"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") onClose();
      }}
      role="listbox"
    >
      {EFFORT_LEVELS.map((level) => (
        <button
          aria-selected={level === thinking}
          className="effort-option"
          key={level}
          onClick={() => onChoose(level)}
          ref={level === thinking ? first : undefined}
          role="option"
          type="button"
        >
          <span aria-hidden="true" className="effort-option-check">
            {level === thinking ? <Icon name="check" /> : null}
          </span>
          {THINKING_LABELS[level]}
        </button>
      ))}
    </div>
  );
}

export function EffortControl({ disabled, thinking, onThinkingChange }: EffortControlProps) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!field.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const close = () => {
    setOpen(false);
    control.current?.focus();
  };
  return (
    <div className="effort-field" ref={field}>
      {open && !disabled ? (
        <EffortMenu
          onChoose={(level) => {
            onThinkingChange(level);
            close();
          }}
          onClose={close}
          thinking={thinking}
        />
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Effort: ${THINKING_LABELS[thinking]}`}
        className="effort-control"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        ref={control}
        title="How much effort the model spends before it answers"
        type="button"
      >
        <Icon name="thinking" />
        <span className="effort-label">Effort</span>
        <span className="effort-value">{THINKING_LABELS[thinking]}</span>
        <span aria-hidden="true" className="effort-caret" />
      </button>
    </div>
  );
}
