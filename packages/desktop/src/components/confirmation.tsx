export interface ConfirmationRequest {
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  intent?: "danger" | "primary";
  title: string;
  onConfirm(): void;
}

interface ConfirmationProps {
  request: ConfirmationRequest | undefined;
  onCancel(): void;
  onConfirm(): void;
}

export function Confirmation({ request, onCancel, onConfirm }: ConfirmationProps) {
  if (request === undefined) return null;
  return (
    <div className="confirmation-backdrop">
      <section
        aria-describedby="confirmation-description"
        aria-labelledby="confirmation-title"
        aria-modal="true"
        className="confirmation-dialog"
        role="alertdialog"
      >
        <h2 id="confirmation-title">{request.title}</h2>
        <p id="confirmation-description">{request.description}</p>
        <div className="confirmation-actions">
          <button onClick={onCancel} type="button">
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            className={
              request.intent === "primary" ? "confirmation-primary" : "confirmation-remove"
            }
            onClick={onConfirm}
            type="button"
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
