import type { ModelRuntimeStatus } from "@vault/shared";
import { Icon } from "./icons.js";

interface ChatHeaderProps {
  technicalDetailsOpen: boolean;
  model: ModelRuntimeStatus;
  nativeActionMessage?: string | undefined;
  onTechnicalDetailsOpen(): void;
  onUnload(): void;
}

const statusText: Record<ModelRuntimeStatus["state"], string> = {
  unsupported: "Not supported on this Mac",
  unloaded: "Loads with your next message",
  loading: "Loading on device",
  busy: "Working on device",
  ready: "Loaded and ready",
};

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

function formatMemory(bytes: number): string {
  if (bytes === 0) return "0 GiB";
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MiB`;
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

function formatContext(tokens: number): string {
  if (tokens < 1024) return tokens.toLocaleString("en-US");
  return `${Number((tokens / 1024).toFixed(2))}K`;
}

function modelUsage(model: ModelRuntimeStatus) {
  if (model.state !== "ready" && model.state !== "busy") return undefined;
  if (model.gpuVramBytes === undefined && model.contextSizeTokens === undefined) return undefined;
  return {
    vram: model.gpuVramBytes === undefined ? undefined : `${formatMemory(model.gpuVramBytes)} VRAM`,
    context:
      model.contextSizeTokens === undefined
        ? undefined
        : `${formatContext(model.contextSizeTokens)} context`,
  };
}

export function ChatHeader({
  technicalDetailsOpen,
  model,
  nativeActionMessage,
  onTechnicalDetailsOpen,
  onUnload,
}: ChatHeaderProps) {
  const modelStatus = model.message ?? statusText[model.state];
  const usage = modelUsage(model);
  return (
    <header className="chat-header" data-tauri-drag-region="">
      <div className="model-identity">
        <div className="model-copy">
          <div className="model-title-row">
            <strong>{model.name}</strong>
            {usage === undefined ? null : (
              <span className="model-usage">
                {usage.vram === undefined ? null : <span>{usage.vram}</span>}
                {usage.context === undefined ? null : <span>{usage.context}</span>}
              </span>
            )}
          </div>
          <span className={`model-state model-state-${model.state}`}>
            <i aria-hidden="true" />
            {modelStatus}
          </span>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="header-action unload-action"
          disabled={model.state !== "ready" || nativeActionMessage !== undefined}
          onClick={onUnload}
          title={
            nativeActionMessage ??
            (model.state === "ready" ? "Unload model from memory" : modelStatus)
          }
          type="button"
        >
          <Icon name="power" />
          <span>Unload</span>
        </button>
        <button
          aria-label="Open technical details"
          className="header-action technical-details-action"
          disabled={technicalDetailsOpen}
          onClick={onTechnicalDetailsOpen}
          title="Technical details"
          type="button"
        >
          <Icon name="activity" />
        </button>
      </div>
    </header>
  );
}
