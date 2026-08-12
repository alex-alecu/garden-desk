import type { ModelRuntimeStatus } from "@vault/shared";
import { contextMeter, vramUsage } from "../model-usage.js";

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  return `${Number((tokens / 1_000).toFixed(1))}K`;
}

function VramLine({ vram }: { vram: NonNullable<ReturnType<typeof vramUsage>> }) {
  const memory = vram.budget === undefined ? vram.used : `${vram.used} of ${vram.budget}`;
  const sequences =
    vram.sequences !== undefined && vram.sequences > 1
      ? ` · ${vram.sequences} parallel sequences`
      : "";
  return (
    <div>
      <dt>VRAM / unified memory</dt>
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
  const vram = vramUsage(model);
  const meter = contextMeter(contextUsedTokens, contextAllocatedTokens, model);
  if (vram === undefined && meter === undefined) return null;
  return (
    <dl className="technical-model-usage">
      {vram === undefined ? null : <VramLine vram={vram} />}
      {meter === undefined ? null : <ContextMeterRow meter={meter} />}
    </dl>
  );
}
