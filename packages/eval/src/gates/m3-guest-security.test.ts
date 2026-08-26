import type { AgentExecutionResult } from "@vault/shared";
import type {
  AgentExecutionObserver,
  AgentSessionExecution,
  CodeAgentLauncher,
  CodeAgentSession,
} from "@vault/workers";
import { describe, expect, it } from "vitest";
import { runGuestSecurityEvidence } from "./m3-guest-security.js";

function executionResult(
  request: AgentSessionExecution,
  input: { exitCode: number; stdout: string; termination: AgentExecutionResult["termination"] },
): AgentExecutionResult {
  const evidence = {
    ...input,
    artifacts: [],
    durationMs: 1,
    stderr: "",
  };
  return request.language === "shell"
    ? {
        ...evidence,
        language: "shell",
        path: null,
        source: null,
        command: request.command,
      }
    : {
        ...evidence,
        language: request.language,
        path: request.path,
        source: request.source ?? "print('probe')",
        command: null,
      };
}

function boundedProbeSession(): CodeAgentSession {
  return {
    async execute(request) {
      if (request.language === "shell" && request.command === "kill -SEGV $$") {
        return executionResult(request, { exitCode: 139, stdout: "", termination: "crash" });
      }
      if (request.language !== "shell" && request.path === "steps/process-limit.py") {
        return executionResult(request, { exitCode: 0, stdout: "31\n", termination: "completed" });
      }
      return executionResult(request, { exitCode: 0, stdout: "True\n", termination: "completed" });
    },
    async cancel() {},
    async close() {},
  };
}

function linkProbeSession(error: Error, diagnostics: Array<"process_start" | "process_exit">) {
  return {
    async execute(
      _request: AgentSessionExecution,
      _signal?: AbortSignal,
      observer?: AgentExecutionObserver,
    ): Promise<AgentExecutionResult> {
      for (const code of diagnostics) {
        await observer?.onUpdate({ kind: "diagnostic", code, platform: "guest" });
      }
      throw error;
    },
    async cancel() {},
    async close() {},
  } satisfies CodeAgentSession;
}

function launcher(
  error: Error,
  diagnostics: Array<"process_start" | "process_exit">,
): CodeAgentLauncher {
  let opened = 0;
  return {
    async openAgentSession() {
      opened += 1;
      return opened === 1 ? boundedProbeSession() : linkProbeSession(error, diagnostics);
    },
    async deleteWorkspace() {},
  };
}

describe("M3 escaping-link security evidence", () => {
  it("accepts the clean helper exit after the link process completed", async () => {
    await expect(
      runGuestSecurityEvidence(
        launcher(new Error("agent_helper_exited_0"), ["process_start", "process_exit"]),
        "/source",
      ),
    ).resolves.toMatchObject({ symlink: "rejected" });
  });

  it("propagates an unrelated helper failure", async () => {
    await expect(
      runGuestSecurityEvidence(
        launcher(new Error("agent_helper_transport_failed"), ["process_start", "process_exit"]),
        "/source",
      ),
    ).rejects.toThrow("agent_helper_transport_failed");
  });

  it("propagates a clean helper exit without complete process evidence", async () => {
    await expect(
      runGuestSecurityEvidence(
        launcher(new Error("agent_helper_exited_0"), ["process_start"]),
        "/source",
      ),
    ).rejects.toThrow("agent_helper_exited_0");
  });
});
