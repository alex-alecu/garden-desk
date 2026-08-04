import type { AgentArtifactSummary } from "@vault/shared";
import { useState } from "react";

type ActionState = "cancelled" | "idle" | "opening" | "saving" | "saved";

function fileType(item: AgentArtifactSummary): { icon: string; label: string } {
  const extension = item.name.split(".").at(-1)?.toLocaleLowerCase("en-US");
  if (extension === "docx") return { icon: "W", label: "Word document" };
  if (extension === "xlsx") return { icon: "X", label: "Excel workbook" };
  if (extension === "pdf") return { icon: "P", label: "PDF document" };
  return {
    icon: "F",
    label: item.mediaType === "application/octet-stream" ? "File" : item.mediaType,
  };
}

function fileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function GeneratedFileCard({
  item,
  disabledReason,
  onOpen,
  onSave,
}: {
  item: AgentArtifactSummary;
  disabledReason: string | undefined;
  onOpen(item: AgentArtifactSummary): Promise<void>;
  onSave(item: AgentArtifactSummary): Promise<boolean>;
}) {
  const [state, setState] = useState<ActionState>("idle");
  const type = fileType(item);
  const disabled = disabledReason !== undefined || state === "opening" || state === "saving";
  return (
    <article className="generated-file-card">
      <button
        aria-label={`Open ${item.name}`}
        className="generated-file-open"
        disabled={disabled}
        onClick={() => {
          setState("opening");
          void onOpen(item).finally(() => setState("idle"));
        }}
        title={disabledReason}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`generated-file-icon generated-file-${type.icon.toLowerCase()}`}
        >
          {type.icon}
        </span>
        <span className="generated-file-description">
          <strong>{item.name}</strong>
          <span>
            {type.label} · {fileSize(item.byteLength)}
          </span>
        </span>
        {state === "opening" ? (
          <span className="generated-file-status" role="status">
            Opening…
          </span>
        ) : null}
      </button>
      <button
        aria-label={`Save ${item.name} as`}
        className="generated-file-save"
        disabled={disabled}
        onClick={() => {
          setState("saving");
          void onSave(item).then((saved) => setState(saved ? "saved" : "cancelled"));
        }}
        title={disabledReason}
        type="button"
      >
        <span aria-live="polite">
          {state === "saving"
            ? "Saving…"
            : state === "saved"
              ? "Saved"
              : state === "cancelled"
                ? "Cancelled"
                : "Save As…"}
        </span>
      </button>
    </article>
  );
}

export function GeneratedFiles({
  artifacts,
  disabledReason,
  onOpen,
  onSave,
}: {
  artifacts: AgentArtifactSummary[];
  disabledReason: string | undefined;
  onOpen(item: AgentArtifactSummary): Promise<void>;
  onSave(item: AgentArtifactSummary): Promise<boolean>;
}) {
  if (artifacts.length === 0) return null;
  return (
    <section aria-label="Generated files" className="generated-files">
      <h3>Generated files</h3>
      {artifacts.map((item) => (
        <GeneratedFileCard
          disabledReason={disabledReason}
          item={item}
          key={item.id}
          onOpen={onOpen}
          onSave={onSave}
        />
      ))}
    </section>
  );
}
