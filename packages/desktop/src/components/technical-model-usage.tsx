import type { ModelRuntimeStatus } from "@gardendesk/shared";
import { contextMeter, gpuMemoryUsage } from "../model-usage.js";

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  return `${Number((tokens / 1_000).toFixed(1))}K`;
}

function GpuMemoryLine({ usage }: { usage: ReturnType<typeof gpuMemoryUsage> }) {
  const memory =
    usage === undefined ? "Not available" : `${usage.used} of ${usage.budget ?? "Not available"}`;
  const sequences =
    usage?.sequences !== undefined && usage.sequences > 1
      ? ` · ${usage.sequences} parallel sequences`
      : "";
  return (
    <tr>
      <th scope="row">{usage?.label ?? "GPU memory"}</th>
      <td>
        {memory}
        {sequences}
      </td>
    </tr>
  );
}

function ContextMeterRow({ meter }: { meter: NonNullable<ReturnType<typeof contextMeter>> }) {
  return (
    <tr className="technical-context-meter">
      <th scope="row">Context</th>
      <td>
        <span className="context-meter-label">
          {formatTokens(meter.used)} / {formatTokens(meter.allocated)} · {meter.percent}%
        </span>
        <span
          aria-hidden="true"
          className={`context-meter-track${meter.warning ? " warning" : ""}`}
        >
          <span className="context-meter-fill" style={{ width: `${meter.percent}%` }} />
        </span>
      </td>
    </tr>
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
  const allocated = contextAllocatedTokens ?? model.contextSizeTokens;
  return (
    <>
      <GpuMemoryLine usage={gpuMemory} />
      {meter === undefined ? (
        <tr>
          <th scope="row">Context</th>
          <td>Not available{allocated === undefined ? "" : ` / ${formatTokens(allocated)}`}</td>
        </tr>
      ) : (
        <ContextMeterRow meter={meter} />
      )}
    </>
  );
}
