interface GuidedExamplesProps {
  disabled: boolean;
  examples: Array<{ label: string; prompt: string }>;
  onRun(prompt: string): void;
}

export function GuidedExamples({ disabled, examples, onRun }: GuidedExamplesProps) {
  if (examples.length === 0) return null;
  return (
    <section aria-label="Guided demo examples" className="guided-examples">
      <p>Try a guided example</p>
      <div>
        {examples.map((example) => (
          <button
            disabled={disabled}
            key={example.prompt}
            onClick={() => onRun(example.prompt)}
            type="button"
          >
            {example.label}
          </button>
        ))}
      </div>
    </section>
  );
}
