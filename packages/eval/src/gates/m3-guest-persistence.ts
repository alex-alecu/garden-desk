import type { WorkerLimits } from "@vault/shared";
import type { CodeAgentLauncher, CodeAgentSession } from "@vault/workers";
import { requireGuestSuccess } from "./m3-guest-execution.js";

export async function persistentFileProbe(session: CodeAgentSession): Promise<void> {
  const result = await session.execute({
    language: "python",
    path: "steps/large-file.py",
    source:
      "with open('large.bin', 'wb') as output:\n    output.truncate(9 * 1024 * 1024)\nprint('large file written')",
  });
  requireGuestSuccess(result);
}

export async function rehydrationProbe(
  launcher: CodeAgentLauncher,
  source: string,
  sessionId: string,
  limits: WorkerLimits,
) {
  const session = await launcher.openAgentSession({
    sessionId,
    sourceFolder: source,
    readonlyInputs: [],
    limits,
  });
  try {
    const result = await session.execute({
      language: "shell",
      command: [
        "test -f steps/probe.py",
        "test -f large.bin",
        "/usr/bin/python3 steps/probe.py",
      ].join(" && "),
    });
    requireGuestSuccess(result);
    return { failedWorkspacePersisted: true, output: result.stdout.trim() };
  } finally {
    await session.close();
  }
}
