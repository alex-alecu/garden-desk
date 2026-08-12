import type { AgentQuestionRequest } from "@vault/shared";
import { handleQuestionKey } from "../question-keyboard.js";
import { type DisplayOption, useQuestionPrompt } from "../use-question-prompt.js";
import { Icon } from "./icons.js";

interface QuestionPromptProps {
  request: AgentQuestionRequest;
  stopping: boolean;
  onAnswer(questionId: string, answers: string[][]): void;
  onDismiss(questionId: string): void;
  onStop(): void;
}

export function QuestionPrompt({
  request,
  stopping,
  onAnswer,
  onDismiss,
  onStop,
}: QuestionPromptProps) {
  const controller = useQuestionPrompt(request, onAnswer, onDismiss);
  return (
    <section
      aria-label="Clarifying question"
      className="question-prompt"
      onKeyDown={(event) => handleQuestionKey(event, controller.dismiss, controller.advance)}
    >
      <QuestionHeader
        onDismiss={controller.dismiss}
        onPage={controller.goToPage}
        page={controller.page}
        question={controller.question.question}
        total={controller.total}
      />
      <QuestionOptions
        custom={controller.custom}
        editing={controller.editing}
        multiple={controller.question.multiple === true}
        onCommitCustom={controller.stopEditing}
        onCustomInput={controller.setCustom}
        onEditCustom={controller.startEditing}
        onSelect={controller.selectOption}
        options={controller.options}
        question={controller.question.question}
        selected={controller.selected}
      />
      <QuestionFooter
        advanceLabel={controller.last ? "Submit" : "Next"}
        onAdvance={controller.advance}
        onSkip={controller.skip}
        onStop={onStop}
        stopping={stopping}
      />
    </section>
  );
}

interface QuestionOptionsProps {
  options: DisplayOption[];
  question: string;
  selected: string[];
  multiple: boolean;
  editing: boolean;
  custom: string;
  onSelect(label: string): void;
  onEditCustom(): void;
  onCommitCustom(): void;
  onCustomInput(value: string): void;
}

function QuestionOptions({
  options,
  question,
  selected,
  multiple,
  editing,
  custom,
  onSelect,
  onEditCustom,
  onCommitCustom,
  onCustomInput,
}: QuestionOptionsProps) {
  return (
    <fieldset className="question-options">
      <legend className="question-visually-hidden">{question}</legend>
      {options.map((option, index) => (
        <OptionButton
          description={option.description}
          index={index}
          key={option.label}
          label={option.label}
          multiple={multiple}
          onSelect={() => onSelect(option.label)}
          picked={selected.includes(option.label)}
          recommended={option.recommended}
        />
      ))}
      <CustomRow
        editing={editing}
        onCommit={onCommitCustom}
        onEdit={onEditCustom}
        onInput={onCustomInput}
        value={custom}
      />
    </fieldset>
  );
}

interface QuestionHeaderProps {
  question: string;
  page: number;
  total: number;
  onPage(next: number): void;
  onDismiss(): void;
}

function QuestionHeader({ question, page, total, onPage, onDismiss }: QuestionHeaderProps) {
  return (
    <header className="question-header">
      <p className="question-text">{question}</p>
      <div className="question-header-actions">
        {total > 1 ? (
          <div className="question-pager">
            <button
              aria-label="Previous question"
              className="icon-button"
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
              type="button"
            >
              <Icon name="chevron-left" />
            </button>
            <span className="question-count">{`${page + 1} of ${total}`}</span>
            <button
              aria-label="Next question"
              className="icon-button"
              disabled={page >= total - 1}
              onClick={() => onPage(page + 1)}
              type="button"
            >
              <Icon name="chevron-right" />
            </button>
          </div>
        ) : null}
        <button
          aria-label="Dismiss question"
          className="icon-button"
          onClick={onDismiss}
          type="button"
        >
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
}

interface QuestionFooterProps {
  advanceLabel: string;
  stopping: boolean;
  onStop(): void;
  onSkip(): void;
  onAdvance(): void;
}

function QuestionFooter({
  advanceLabel,
  stopping,
  onStop,
  onSkip,
  onAdvance,
}: QuestionFooterProps) {
  return (
    <footer className="question-footer">
      <button className="question-stop" disabled={stopping} onClick={onStop} type="button">
        Stop
      </button>
      <div className="question-footer-actions">
        <button className="question-skip" onClick={onSkip} type="button">
          Skip
        </button>
        <button className="question-advance" onClick={onAdvance} type="button">
          {advanceLabel}
        </button>
      </div>
    </footer>
  );
}

interface OptionButtonProps {
  index: number;
  label: string;
  description: string;
  multiple: boolean;
  picked: boolean;
  recommended: boolean;
  onSelect(): void;
}

function OptionButton({
  index,
  label,
  description,
  multiple,
  picked,
  recommended,
  onSelect,
}: OptionButtonProps) {
  return (
    <label className={`question-option${picked ? " question-option-picked" : ""}`}>
      <input
        checked={picked}
        className="question-option-input"
        name="clarifying-question-option"
        onChange={onSelect}
        type={multiple ? "checkbox" : "radio"}
      />
      <span aria-hidden="true" className="question-option-index">
        {index + 1}
      </span>
      <span className="question-option-body">
        <span className="question-option-label" title={label}>
          {label}
        </span>
        {recommended ? <span className="question-option-badge">Recommended</span> : null}
        {description.length > 0 ? (
          <span className="question-option-description" title={description}>
            {description}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="question-option-arrow">
        <Icon name="arrow-right" />
      </span>
    </label>
  );
}

interface CustomRowProps {
  editing: boolean;
  value: string;
  onEdit(): void;
  onCommit(): void;
  onInput(value: string): void;
}

function CustomRow({ editing, value, onEdit, onCommit, onInput }: CustomRowProps) {
  if (!editing) {
    return (
      <button className="question-option question-custom" onClick={onEdit} type="button">
        <span aria-hidden="true" className="question-option-index">
          <Icon name="pencil" />
        </span>
        <span className="question-option-body">
          <span
            className="question-option-label question-custom-label"
            title={value.trim().length > 0 ? value : undefined}
          >
            {value.trim().length > 0 ? value : "Type your own answer"}
          </span>
        </span>
      </button>
    );
  }
  return (
    <div className="question-option question-custom question-custom-editing">
      <span aria-hidden="true" className="question-option-index">
        <Icon name="pencil" />
      </span>
      <textarea
        aria-label="Type your own answer"
        className="question-custom-input"
        maxLength={300}
        ref={(element) => element?.focus()}
        onBlur={onCommit}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            onCommit();
          }
        }}
        placeholder="Type your own answer"
        rows={1}
        value={value}
      />
    </div>
  );
}
