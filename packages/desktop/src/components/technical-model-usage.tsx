import type { ModelRuntimeStatus } from "@vault/shared";
import { contextMeter, gpuMemoryUsage } from "../model-usage.js";

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  return `${Number((tokens / 1_000).toFixed(1))}K`;
}

function GpuMemoryLine({ usage }: { usage: NonNullable<ReturnType<typeof gpuMemoryUsage>> }) {
  const memory = usage.budget === undefined ? usage.used : `${usage.used} of ${usage.budget}`;
  const sequences =
    usage.sequences !== undefined && usage.sequences > 1
      ? ` · ${usage.sequences} parallel sequences`
      : "";
  return (
    <div>
      <dt>{usage.label}</dt>
      <dd>
        {memory}
        {sequences}
      </dd>
    </div>
  );
}

function ContextMeterRow({ meter }: { meter: NonNullable<ReturnType<typeof contextMeter>> }) {
  return (
    <div className="technical-context-meter">
      <dt>Context</dt>
      <dd>
        <span className="context-meter-label">
          {formatTokens(meter.used)} / {formatTokens(meter.allocated)} · {meter.percent}%
        </span>
        <span
          aria-hidden="true"
          className={`context-meter-track${meter.warning ? " warning" : ""}`}
        >
          <span className="context-meter-fill" style={{ width: `${meter.percent}%` }} />
        </span>
      </dd>
    </div>
  );
}

export function TechnicalModelUsage({
  model,
  contextUsedTokens = null,
  contextAllocatedTokens = null,
}: {
  model: ModelRuntimeStatus;
  contextUsedTokens?: number | null | undefined;
  contextAllocatedTokens?: number | null | undefined;
}) {
  const gpuMemory = gpuMemoryUsage(model);
  const meter = contextMeter(contextUsedTokens, contextAllocatedTokens, model);
  if (gpuMemory === undefined && meter === undefined) return null;
  return (
    <dl className="technical-model-usage">
      {gpuMemory === undefined ? null : <GpuMemoryLine usage={gpuMemory} />}
      {meter === undefined ? null : <ContextMeterRow meter={meter} />}
    </dl>
  );
}
