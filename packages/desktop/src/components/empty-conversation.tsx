interface EmptyConversationProps {
  folderName?: string | undefined;
  onSuggestion(text: string): void;
  ready: boolean;
}

export function EmptyConversation({ folderName, onSuggestion, ready }: EmptyConversationProps) {
  return (
    <div className="welcome">
      <h1>
        What should we work on{folderName === undefined ? "" : ` in `}
        {folderName === undefined ? "" : <span className="welcome-folder">{folderName}</span>}?
      </h1>
      <p>
        {ready
          ? "Select a folder, attach files in New chat, or start with a question."
          : "Starting your private workspace…"}
      </p>
      <div className="suggestions">
        <button
          disabled={!ready}
          onClick={() => onSuggestion("Explore and explain the selected files.")}
          type="button"
        >
          Explore and understand files
        </button>
        <button
          disabled={!ready}
          onClick={() => onSuggestion("Review these files and suggest practical improvements.")}
          type="button"
        >
          Review and suggest improvements
        </button>
        <button
          disabled={!ready}
          onClick={() => onSuggestion("Compare the selected documents or data.")}
          type="button"
        >
          Compare documents or data
        </button>
        <button
          disabled={!ready}
          onClick={() => onSuggestion("Diagnose the issue in the selected files.")}
          type="button"
        >
          Diagnose an issue
        </button>
      </div>
    </div>
  );
}
