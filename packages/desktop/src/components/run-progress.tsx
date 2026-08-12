import type { TimelineItem } from "../state.js";

interface RunProgressProps {
  runId: string | undefined;
  timeline: TimelineItem[];
}

export function RunProgress({ runId, timeline }: RunProgressProps) {
  const current = timeline.filter((item) => item.kind === "activity" && item.runId === runId);
  const completedTools = current.filter((item) => item.eventType === "tool.completed").length;
  const completedExecutions = current.filter(
    (item) => item.eventType === "execution.completed",
  ).length;
  const progress =
    completedTools > 0
      ? `${completedTools} tool call${completedTools === 1 ? "" : "s"} completed`
      : completedExecutions > 0
        ? `${completedExecutions} execution${completedExecutions === 1 ? "" : "s"} completed`
        : "Planning the first tool call";
  return (
    <article className="thinking-stream run-progress">
      <header>
        <span aria-hidden="true" className="thinking-pulse" />
        Working locally
      </header>
      <p>{current.at(-1)?.text ?? "Starting the task…"}</p>
      <small>{progress}</small>
    </article>
  );
}
