import type { TimelineItem } from "../state.js";

interface RunProgressProps {
  runId: string | undefined;
  timeline: TimelineItem[];
}

export function RunProgress({ runId, timeline }: RunProgressProps) {
  const current = timeline.filter((item) => item.kind === "activity" && item.runId === runId);
  const completed = current.filter((item) => item.eventType === "execution.completed").length;
  return (
    <article className="thinking-stream run-progress">
      <header>
        <span aria-hidden="true" className="thinking-pulse" />
        Working locally
      </header>
      <p>{current.at(-1)?.text ?? "Starting the task…"}</p>
      <small>
        {completed === 0
          ? "Planning the first execution"
          : `${completed} execution${completed === 1 ? "" : "s"} completed`}
      </small>
    </article>
  );
}
