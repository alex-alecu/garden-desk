interface QuestionToolProps {
  disabled: boolean;
  filesDone: number;
  filesTotal: number;
  onContinue(): void;
  onDismiss(): void;
}

export function QuestionTool({
  disabled,
  filesDone,
  filesTotal,
  onContinue,
  onDismiss,
}: QuestionToolProps) {
  return (
    <section aria-labelledby="continuation-question-title" className="question-tool">
      <header>
        <div>
          <h2 id="continuation-question-title">Continue this task?</h2>
          <p>
            Processed {filesDone} of {filesTotal} XLSX files. Progress is saved locally.
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
