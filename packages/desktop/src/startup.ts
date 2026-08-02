import type { DesktopApi, DesktopBootstrap } from "./api.js";

export interface DesktopBootstrapRequest {
  api: DesktopApi;
  promise: Promise<DesktopBootstrap>;
}

export function desktopBootstrapRequest(
  api: DesktopApi,
  current?: DesktopBootstrapRequest,
): DesktopBootstrapRequest {
  return current?.api === api ? current : { api, promise: api.bootstrapDesktop() };
}
