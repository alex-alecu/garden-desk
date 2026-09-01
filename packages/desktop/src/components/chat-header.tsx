import type { ModelRuntimeStatus } from "@gardendesk/shared";
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

const appearanceLabels: Record<AppearancePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

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
