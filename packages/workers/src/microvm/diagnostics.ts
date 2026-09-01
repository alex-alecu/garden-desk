import type { AgentVmDiagnosticCode } from "@gardendesk/shared";
import type { AgentExecutionObserver } from "./launcher.js";

export async function emitDiagnostic(
  observer: AgentExecutionObserver | undefined,
  platform: "macos" | "windows",
  code: AgentVmDiagnosticCode,
  error?: unknown,
): Promise<void> {
  const platformCode = (error as NodeJS.ErrnoException | undefined)?.code;
  await observer?.onUpdate(
    platformCode === undefined || !/^[A-Za-z0-9_:.-]{1,64}$/u.test(platformCode)
      ? { kind: "diagnostic", code, platform }
      : { kind: "diagnostic", code, platform, platformCode },
  );
}
