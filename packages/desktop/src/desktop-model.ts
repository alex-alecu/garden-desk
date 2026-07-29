import type { AgentRunState, ModelRuntimeStatus } from "@vault/shared";
import { useEffect } from "react";
import type { DesktopApi } from "./api.js";

export const initialModelStatus: ModelRuntimeStatus = {
  modelId: "gemma-4-12b-it-qat-q4_0",
  name: "Gemma 4 12B QAT",
  state: "unloaded",
  thinkingSupported: true,
};

export function useModelRefresh(
  api: DesktopApi,
  loaded: boolean,
  runState: AgentRunState | undefined,
  setModel: (model: ModelRuntimeStatus) => void,
) {
  useEffect(() => {
    if (!loaded) return;
    const running = runState === "queued" || runState === "running";
    const refresh = () =>
      void api
        .getModelStatus()
        .then(setModel)
        .catch(() => undefined);
    refresh();
    if (!running) return;
    const timer = window.setInterval(refresh, 700);
    return () => window.clearInterval(timer);
  }, [api, loaded, runState, setModel]);
}
