import type { ModelRuntimeStatus } from "@gardendesk/shared";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import { useEffect } from "react";
import type { DesktopApi } from "./api.js";

export const initialModelStatus: ModelRuntimeStatus = {
  modelId: INFERENCE_PROFILE.modelId,
  name: INFERENCE_PROFILE.name,
  state: "unloaded",
  thinkingSupported: true,
};

export function useModelRefresh(
  api: DesktopApi,
  loaded: boolean,
  refreshing: boolean,
  setModel: (model: ModelRuntimeStatus) => void,
) {
  useEffect(() => {
    if (!loaded) return;
    const refresh = () =>
      void api
        .getModelStatus()
        .then(setModel)
        .catch(() => undefined);
    refresh();
    if (!refreshing) return;
    const timer = window.setInterval(refresh, 700);
    return () => window.clearInterval(timer);
  }, [api, loaded, refreshing, setModel]);
}
