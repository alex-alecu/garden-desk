import type { ModelRuntimeStatus } from "@vault/shared";
import { type AppearancePreference, nextAppearance } from "../appearance.js";
import { Icon } from "./icons.js";

interface ChatHeaderProps {
  appearance: AppearancePreference;
  technicalDetailsOpen: boolean;
  model: ModelRuntimeStatus;
  nativeActionMessage?: string | undefined;
  onAppearanceChange(): void;
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
const appearanceLabels: Record<AppearancePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

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
  if (
    model.memoryBudgetBytes === undefined &&
    model.cpuRamBytes === undefined &&
    model.gpuVramBytes === undefined &&
    model.contextSizeTokens === undefined
  )
    return undefined;
  const allocatedBytes = (model.cpuRamBytes ?? 0) + (model.gpuVramBytes ?? 0);
  return {
    budget:
      model.memoryBudgetBytes === undefined
        ? undefined
        : `${formatMemory(model.memoryBudgetBytes)} budget`,
    allocated:
      model.cpuRamBytes === undefined && model.gpuVramBytes === undefined
        ? undefined
        : `${formatMemory(allocatedBytes)} allocated`,
    context:
      model.contextSizeTokens === undefined
        ? undefined
        : `${formatContext(model.contextSizeTokens)} context`,
  };
}

function ModelUsage({ model }: { model: ModelRuntimeStatus }) {
  const usage = modelUsage(model);
  if (usage === undefined) return null;
  return (
    <span className="model-usage">
      {usage.budget === undefined ? null : <span>{usage.budget}</span>}
      {usage.allocated === undefined ? null : <span>{usage.allocated}</span>}
      {usage.context === undefined ? null : <span>{usage.context}</span>}
    </span>
  );
}

function AppearanceControl({
  appearance,
  onChange,
}: {
  appearance: AppearancePreference;
  onChange(): void;
}) {
  const next = nextAppearance(appearance);
  return (
    <button
      aria-label={`Appearance: ${appearanceLabels[appearance]}. Switch to ${appearanceLabels[next]}`}
      className="header-action appearance-action"
      onClick={onChange}
      title={`Appearance: ${appearanceLabels[appearance]} · Next: ${appearanceLabels[next]}`}
      type="button"
    >
      <Icon name={`appearance-${appearance}`} />
    </button>
  );
}

export function ChatHeader({
  appearance,
  technicalDetailsOpen,
  model,
  nativeActionMessage,
  onAppearanceChange,
  onTechnicalDetailsOpen,
  onUnload,
}: ChatHeaderProps) {
  const modelStatus = model.message ?? statusText[model.state];
  return (
    <header className="chat-header" data-tauri-drag-region="">
      <div className="model-identity">
        <div className="model-copy">
          <div className="model-title-row">
            <strong>{model.name}</strong>
            <ModelUsage model={model} />
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
        <AppearanceControl appearance={appearance} onChange={onAppearanceChange} />
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
