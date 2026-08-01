import type { ModelRuntimeStatus } from "@vault/shared";
import { modelUsage } from "../model-usage.js";

export function TechnicalModelUsage({ model }: { model: ModelRuntimeStatus }) {
  const usage = modelUsage(model);
  if (usage === undefined) return null;
  return (
    <dl className="technical-model-usage">
      {usage.ram === undefined ? null : (
        <div>
          <dt>RAM allocation</dt>
          <dd>{usage.ram}</dd>
        </div>
      )}
      {usage.vram === undefined ? null : (
        <div>
          <dt>VRAM / unified memory allocation</dt>
          <dd>{usage.vram}</dd>
        </div>
      )}
      {usage.totalAllocated === undefined ? null : (
        <div>
          <dt>Total model and context allocation</dt>
          <dd>{usage.totalAllocated}</dd>
        </div>
      )}
      {usage.budget === undefined ? null : (
        <div>
          <dt>VRAM / unified memory budget</dt>
          <dd>{usage.budget}</dd>
        </div>
      )}
      {usage.context === undefined ? null : (
        <div>
          <dt>Context allocated</dt>
          <dd>{usage.context} tokens</dd>
        </div>
      )}
      {usage.contextLimit === undefined ? null : (
        <div>
          <dt>Context hardware cap</dt>
          <dd>{usage.contextLimit} tokens</dd>
        </div>
      )}
      {usage.contextExplanation === undefined ? null : (
        <div className="technical-model-reason">
          <dt>Why this context</dt>
          <dd>{usage.contextExplanation}</dd>
        </div>
      )}
    </dl>
  );
}
