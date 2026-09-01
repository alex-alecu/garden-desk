import type { ModelRuntimeStatus } from "@gardendesk/shared";
import { expect, it, vi } from "vitest";
import type { DesktopApi } from "./api.js";

const useEffect = vi.hoisted(() => vi.fn((effect: () => void) => effect()));
vi.mock("react", () => ({ useEffect }));

import { useModelRefresh } from "./desktop-model.js";

it("keeps refreshing a busy model after the visible run succeeds", () => {
  const model: ModelRuntimeStatus = {
    modelId: "gemma-4-12b-it-qat-q4_0",
    name: "Gemma 4 12B QAT",
    state: "busy",
    thinkingSupported: true,
  };
  const setInterval = vi.fn(() => 1);
  vi.stubGlobal("window", { setInterval, clearInterval: vi.fn() });
  const api = {
    getModelStatus: vi.fn().mockResolvedValue(model),
  } as unknown as DesktopApi;

  useModelRefresh(api, true, model.state === "busy", vi.fn());

  expect(setInterval).toHaveBeenCalledOnce();
});
