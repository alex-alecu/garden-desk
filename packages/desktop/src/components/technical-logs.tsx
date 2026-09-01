import type { AgentExecutionSnapshot } from "@gardendesk/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { selectAdjacentTab } from "./tab-keyboard.js";

type LogStream = "stdout" | "stderr" | "vm";

const DIAGNOSTIC_LABELS = {
  staging: "Staging approved inputs",
  vm_start: "Starting the no-network VM",
  guest_connection: "Guest control connection ready",
  process_start: "Guest process started",
  process_exit: "Guest process exited",
  teardown: "VM teardown completed",
  platform_error: "Platform operation failed",
} as const;

function isActive(execution: AgentExecutionSnapshot): boolean {
  return execution.state === "starting" || execution.state === "running";
}

function vmLog(execution: AgentExecutionSnapshot): string {
  return execution.vmDiagnostics
    .map((item) => {
      const platformCode = item.platformCode === null ? "" : ` (${item.platformCode})`;
      return `${item.createdAt}  ${DIAGNOSTIC_LABELS[item.code]} [${item.platform}]${platformCode}`;
    })
    .join("\n");
}

export function shouldFollowLog(scrollHeight: number, scrollTop: number, clientHeight: number) {
  return scrollHeight - scrollTop - clientHeight <= 40;
}

function StreamViewer({
  active,
  execution,
  stream,
}: {
  active: boolean;
  execution: AgentExecutionSnapshot;
  stream: LogStream;
}) {
  const element = useRef<HTMLTextAreaElement>(null);
  const [following, setFollowing] = useState(true);
  const text =
    stream === "stdout"
      ? execution.stdout
      : stream === "stderr"
        ? execution.stderr
        : vmLog(execution);
  useEffect(() => {
    if (active && following && text.length > 0 && element.current !== null) {
      element.current.scrollTop = element.current.scrollHeight;
    }
  }, [active, following, text]);
  return (
    <div className="technical-log-viewer">
      <textarea
        aria-label={`${stream === "vm" ? "VM diagnostics" : stream === "stdout" ? "Output" : "Errors"} for execution ${execution.sequence + 1}`}
        onScroll={(event) => {
          const target = event.currentTarget;
          setFollowing(shouldFollowLog(target.scrollHeight, target.scrollTop, target.clientHeight));
        }}
        readOnly
        ref={element}
        value={text.length === 0 ? "No entries." : text}
      />
      {active && !following ? (
        <button
          className="jump-to-latest"
          onClick={() => {
            if (element.current !== null) element.current.scrollTop = element.current.scrollHeight;
            setFollowing(true);
          }}
          type="button"
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}

export function StreamTabs({ execution }: { execution: AgentExecutionSnapshot }) {
  const [stream, setStream] = useState<LogStream>("stdout");
  const streamIds = ["stdout", "stderr", "vm"] as const;
  const streams = [
    { id: "stdout" as const, label: "Output", bytes: execution.stdoutBytes },
    { id: "stderr" as const, label: "Errors", bytes: execution.stderrBytes },
    { id: "vm" as const, label: "VM diagnostics", bytes: execution.vmDiagnosticsBytes },
  ];
  return (
    <div className="technical-streams">
      <div
        aria-label={`Log streams for execution ${execution.sequence + 1}`}
        className="stream-tabs"
        role="tablist"
      >
        {streams.map((item) => (
          <button
            aria-controls={`execution-${execution.id}-${item.id}`}
            aria-selected={stream === item.id}
            key={item.id}
            onClick={() => setStream(item.id)}
            onKeyDown={(event) => selectAdjacentTab(event, item.id, streamIds, setStream)}
            role="tab"
            tabIndex={stream === item.id ? 0 : -1}
            type="button"
          >
            {item.label} <span>{item.bytes} B</span>
          </button>
        ))}
      </div>
      <div id={`execution-${execution.id}-${stream}`} role="tabpanel">
        <StreamViewer active={isActive(execution)} execution={execution} stream={stream} />
      </div>
    </div>
  );
}

export function ExecutionStatus({ execution }: { execution: AgentExecutionSnapshot }) {
  const truncated = [
    execution.stdoutTruncated ? "output truncated" : null,
    execution.stderrTruncated ? "errors truncated" : null,
    execution.vmDiagnosticsTruncated ? "VM diagnostics truncated" : null,
  ].filter((item): item is string => item !== null);
  return (
    <div className="execution-badges">
      <span>{execution.state}</span>
      {truncated.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function ExecutionLogRow({
  execution,
  open,
  toggle,
}: {
  execution: AgentExecutionSnapshot;
  open: boolean;
  toggle(): void;
}) {
  return (
    <article className="technical-details-item technical-log-item">
      <button
        aria-controls={`execution-${execution.id}-logs`}
        aria-expanded={open}
        className="execution-toggle"
        onClick={toggle}
        type="button"
      >
        <span>
          Execution {execution.sequence + 1} · {execution.language}
        </span>
        <ExecutionStatus execution={execution} />
      </button>
      {open ? (
        <div id={`execution-${execution.id}-logs`}>
          <StreamTabs execution={execution} />
        </div>
      ) : null}
    </article>
  );
}

export function LogsPanel({ executions }: { executions: AgentExecutionSnapshot[] }) {
  const newest = useMemo(() => [...executions].reverse(), [executions]);
  const activeId = newest.find(isActive)?.id;
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeId === undefined ? [] : [activeId]),
  );
  const [autoExpanded, setAutoExpanded] = useState(activeId);
  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      if (autoExpanded !== undefined && autoExpanded !== activeId) next.delete(autoExpanded);
      if (activeId !== undefined) next.add(activeId);
      return next;
    });
    setAutoExpanded(activeId);
  }, [activeId, autoExpanded]);
  return (
    <div className="technical-details-scroll" id="technical-logs-panel" role="tabpanel">
      {newest.length === 0 ? <p className="technical-details-empty">No executions yet.</p> : null}
      {newest.map((execution) => (
        <ExecutionLogRow
          execution={execution}
          key={execution.id}
          open={expanded.has(execution.id)}
          toggle={() => {
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(execution.id)) next.delete(execution.id);
              else next.add(execution.id);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
}
