interface QuestionToolProps {
  disabled: boolean;
  done: number;
  total: number;
  onContinue(): void;
  onDismiss(): void;
}

export function QuestionTool({ disabled, done, total, onContinue, onDismiss }: QuestionToolProps) {
  return (
    <section aria-labelledby="continuation-question-title" className="question-tool">
      <header>
        <div>
          <h2 id="continuation-question-title">Continue this task?</h2>
          <p>
            Processed {done} of {total} items. Progress is saved locally.
          </p>
        </div>
        <button
          aria-label="Dismiss continuation question"
          className="question-tool-dismiss"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </header>
      <button
        className="question-tool-action"
        disabled={disabled}
        onClick={onContinue}
        type="button"
      >
        <span aria-hidden="true" className="question-tool-number">
          1
        </span>
        <span>Continue from saved progress</span>
        <span aria-hidden="true" className="question-tool-arrow">
          →
        </span>
      </button>
    </section>
  );
}
