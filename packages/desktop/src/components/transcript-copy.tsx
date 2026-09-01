import type { AgentArtifactSummary, AgentExecutionSnapshot } from "@gardendesk/shared";
import { useEffect, useRef, useState } from "react";
import { sessionTranscript, transcriptHasContent } from "../session-transcript.js";
import type { TimelineItem } from "../state.js";
import { Icon } from "./icons.js";
import { copyUserMessage } from "./user-message.js";

type CopyState = "copied" | "failed" | "idle";

export function TranscriptCopy({
  sessionId,
  title,
  timeline,
  executions,
  artifacts,
  nativeActionMessage,
}: {
  sessionId: string;
  title: string;
  timeline: TimelineItem[];
  executions: AgentExecutionSnapshot[];
  artifacts: AgentArtifactSummary[];
  nativeActionMessage: string | undefined;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );
  const disabledReason = disabled(nativeActionMessage, timeline);
  const copy = async () => {
    try {
      await copyUserMessage(
        sessionTranscript({ sessionId, title, timeline, executions, artifacts }),
      );
      setState("copied");
    } catch {
      setState("failed");
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2_000);
  };
  return (
    <div className="transcript-copy">
      <button
        disabled={disabledReason !== undefined}
        onClick={() => void copy()}
        title={disabledReason}
        type="button"
      >
        <Icon name={state === "copied" ? "copy-check" : "copy"} />
        <span aria-live="polite">{label(state)}</span>
      </button>
    </div>
  );
}

function disabled(
  nativeActionMessage: string | undefined,
  timeline: TimelineItem[],
): string | undefined {
  if (nativeActionMessage !== undefined) return nativeActionMessage;
  if (!transcriptHasContent(timeline)) return "The transcript appears after a task runs.";
  return undefined;
}

function label(state: CopyState): string {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return "Copy session transcript";
}
