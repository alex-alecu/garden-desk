import type {
  AgentArtifactSummary,
  AgentRunPerformance,
  AttachmentSummary,
} from "@gardendesk/shared";
import { useEffect, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactSaveResult } from "../artifact-actions.js";
import type { TimelineItem } from "../state.js";
import { stableStreamingMarkdown } from "../streaming-markdown.js";
import { GeneratedFiles } from "./generated-files.js";
import { Icon } from "./icons.js";
import { copyUserMessage, UserMessage } from "./user-message.js";

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  return `${minutes}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}
function ResponseMetrics({ performance }: { performance: AgentRunPerformance }) {
  return (
    <footer className="response-metrics">
      <span>
        <strong>{performance.promptTokensPerSecond.toFixed(1)}</strong> prompt tok/s
      </span>
      <span>
        <strong>{performance.tokensPerSecond.toFixed(1)}</strong> generation tok/s
      </span>
      <span>
        <strong>{formatDuration(performance.totalDurationMs)}</strong> total
      </span>
    </footer>
  );
}

// biome-ignore-start lint/a11y/noNoninteractiveTabindex: Overflowing response content needs a keyboard scroll target.
const assistantMarkdownComponents: Components = {
  pre({ children }) {
    return (
      <section aria-label="Response code">
        <pre tabIndex={0}>{children}</pre>
      </section>
    );
  },
  table({ children }) {
    return (
      <section aria-label="Response table" className="assistant-table-scroll" tabIndex={0}>
        <table>{children}</table>
      </section>
    );
  },
};
// biome-ignore-end lint/a11y/noNoninteractiveTabindex: Overflowing response content needs a keyboard scroll target.

function AssistantResponse({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <div className={`assistant-markdown${streaming ? " assistant-markdown-streaming" : ""}`}>
      <Markdown
        components={assistantMarkdownComponents}
        disallowedElements={["a", "img"]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {streaming ? stableStreamingMarkdown(children) : children}
      </Markdown>
    </div>
  );
}

function ResponseCopyButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await copyUserMessage(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  };
  const label = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy";
  return (
    <div className="response-actions">
      <button aria-label={`${label} response`} onClick={copy} title={label} type="button">
        <Icon name={copyState === "copied" ? "copy-check" : "copy"} />
        <span aria-live="polite">{copyState === "idle" ? "" : label}</span>
      </button>
    </div>
  );
}

export function TimelineMessage({
  attachments,
  item,
  artifacts,
  nativeActionMessage,
  onOpenArtifact,
  onOpenAttachment,
  onSaveArtifact,
  showMetrics,
  performance,
}: {
  attachments: AttachmentSummary[];
  artifacts: AgentArtifactSummary[];
  item: TimelineItem;
  nativeActionMessage: string | undefined;
  onOpenArtifact(item: AgentArtifactSummary): Promise<void>;
  onOpenAttachment(attachmentId: string): void;
  onSaveArtifact(item: AgentArtifactSummary): Promise<ArtifactSaveResult>;
  performance: AgentRunPerformance | null;
  showMetrics: boolean;
}) {
  if (item.kind === "user") {
    return (
      <UserMessage attachments={attachments} item={item} onOpenAttachment={onOpenAttachment} />
    );
  }
  return (
    <article className={`timeline-item timeline-${item.kind}`}>
      <AssistantResponse streaming={item.streaming === true}>{item.text}</AssistantResponse>
      <GeneratedFiles
        artifacts={artifacts}
        disabledReason={nativeActionMessage}
        onOpen={onOpenArtifact}
        onSave={onSaveArtifact}
      />
      {item.kind === "assistant" && item.streaming !== true ? (
        <ResponseCopyButton text={item.text} />
      ) : null}
      {showMetrics && performance !== null ? <ResponseMetrics performance={performance} /> : null}
    </article>
  );
}
