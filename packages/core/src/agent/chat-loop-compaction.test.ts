import { AgentExecutionSnapshotSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentExecutionAttemptError, type AgentExecutor } from "./agent-executor.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

const transportError = `agent_helper_transport_failed:${"x".repeat(500)}:must-not-retain`;

function preparedTransportAttempt() {
  return AgentExecutionSnapshotSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    sequence: 1,
    language: "python",
    path: "steps/new.py",
    source: 'print("new")',
    command: null,
    state: "failed",
    exitCode: null,
    durationMs: null,
    termination: "crash",
    stdout: "",
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    vmDiagnosticsBytes: 2,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:01.000Z",
    completedAt: "2026-08-26T00:00:01.000Z",
  });
}

function orderedFailureExecutor(): AgentExecutor {
  let attempt = 0;
  return {
    async execute(run, _signal, onStarted) {
      attempt += 1;
      if (attempt === 1) return execution(source(run), "older failure", 1);
      onStarted?.();
      throw new AgentExecutionAttemptError(transportError, preparedTransportAttempt());
    },
  };
}

function retainedFailure(
  messages: Parameters<InferenceService["chat"]>[0]["messages"] | undefined,
) {
  const workspaceState = messages?.[2];
  if (workspaceState?.role !== "user") throw new Error("missing_workspace_state");
  const encoded = workspaceState.text.match(/<workspace-state>\n(.+)\n<\/workspace-state>/u)?.[1];
  if (encoded === undefined) throw new Error("invalid_workspace_state");
  return JSON.parse(encoded) as {
    lastExecutionFailure: { errorText: string; exitCode: number | null; termination: string };
  };
}

describe("ChatAgentLoop compaction", () => {
  it("compacts at 80 percent while retaining the current request and last two assistant turns", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [tool("list", "call-1", { path: "/source" })], 6_554),
          generated("Older work is complete."),
          generated("Done."),
        ],
        requests,
      ),
    );
    const history = {
      messages: [
        { role: "user" as const, content: "oldest user turn" },
        { role: "assistant" as const, content: "oldest assistant turn" },
        { role: "user" as const, content: "older user turn" },
        { role: "assistant" as const, content: "older assistant turn" },
        { role: "user" as const, content: "recent user turn" },
        { role: "assistant" as const, content: "recent assistant turn" },
      ],
    };

    await loop.run(
      input(
        {
          async execute(run) {
            return execution(source(run));
          },
          async inspect(run) {
            return execution(source(run));
          },
        },
        ["list"],
        { history, task: "current user turn" },
      ),
    );

    expect(requests[1]?.messages[1]).toMatchObject({
      role: "user",
      text: expect.stringContaining("oldest user turn"),
    });
    expect(requests[2]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: expect.stringContaining("<anchored-summary>"),
        }),
        expect.objectContaining({ role: "user", text: "current user turn" }),
        expect.objectContaining({ role: "assistant", text: "recent assistant turn" }),
        expect.objectContaining({ role: "assistant", toolCalls: expect.any(Array) }),
      ]),
    );
  });
});

describe("ChatAgentLoop failed execution context", () => {
  it("keeps three different failed attempts available to the model", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const failures = ["call-1", "call-2", "call-3"].map((id) =>
      generated("", [tool("list", id, { path: `/source/${id}` })]),
    );
    const loop = new ChatAgentLoop(model([...failures, generated("New approach.")], requests));
    const failedExecutor = {
      async inspect(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
      async execute(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
    };

    await loop.run(input(failedExecutor, ["list"]));

    const failuresInContext = (requests[3]?.messages ?? []).filter(
      (message) => message.role === "tool" && message.result.includes("permission denied"),
    );
    expect(
      failuresInContext.map((message) => message.role === "tool" && message.toolCallId),
    ).toEqual(["call-1", "call-2", "call-3"]);
  });
});

describe("ChatAgentLoop deterministic compaction state", () => {
  it("places named scripts and the last failure after the anchored summary", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const first = generated(
      "",
      [tool("python", "repair", { source: "raise SyntaxError()", path: "steps/repair.py" })],
      6_554,
    );
    const loop = new ChatAgentLoop(
      model(
        [first, generated("The script failed and needs repair."), generated("Done.")],
        requests,
      ),
    );

    await loop.run(
      input(
        {
          async execute(run) {
            return execution(source(run), "SyntaxError: invalid syntax", 1);
          },
        },
        ["python"],
      ),
    );

    expect(requests[2]?.messages[1]).toMatchObject({
      role: "user",
      text: expect.stringContaining("<anchored-summary>"),
    });
    const workspaceState = requests[2]?.messages[2];
    expect(workspaceState).toMatchObject({
      role: "user",
      text: expect.stringContaining("<workspace-state>"),
    });
    if (workspaceState?.role !== "user") throw new Error("missing_workspace_state");
    expect(workspaceState.text).toContain('"scriptPaths":["steps/repair.py"]');
    expect(workspaceState.text).toContain('"exitCode":1');
    expect(workspaceState.text).toContain('"termination":"completed"');
    expect(workspaceState.text).toContain("SyntaxError: invalid syntax");
  });
});

describe("ChatAgentLoop prepared transport compaction state", () => {
  it("retains the latest prepared transport failure with bounded safe text", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const first = generated("", [
      tool("python", "old-failure", { source: "raise OSError()", path: "steps/old.py" }),
    ]);
    const second = generated("", [tool("python", "transport", { path: "steps/new.py" })], 6_554);
    const loop = new ChatAgentLoop(
      model([first, second, generated("Keep the latest failure."), generated("Done.")], requests),
    );

    await loop.run(input(orderedFailureExecutor(), ["python"]));

    expect(requests[3]?.messages[1]).toMatchObject({
      role: "user",
      text: expect.stringContaining("<anchored-summary>"),
    });
    const failure = retainedFailure(requests[3]?.messages).lastExecutionFailure;
    expect(requests[3]?.messages[2]).toMatchObject({
      role: "user",
      text: expect.stringContaining('"scriptPaths":["steps/old.py","steps/new.py"]'),
    });
    expect(failure).toMatchObject({ termination: "crash", exitCode: null });
    expect(failure.errorText).toContain("agent_helper_transport_failed");
    expect(failure.errorText).toHaveLength(400);
    expect(failure.errorText).not.toContain("older failure");
    expect(failure.errorText).not.toContain("must-not-retain");
  });
});

describe("ChatAgentLoop inference recovery", () => {
  it("compacts established history and retries once after an inference failure", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const replies = [
      generated("", [tool("list", "call-1", { path: "/source" })]),
      generated("Recovered context."),
      generated("Done after retry."),
    ];
    let call = 0;
    const loop = new ChatAgentLoop({
      async chat(request) {
        requests.push(structuredClone(request));
        call += 1;
        if (call === 2) throw new Error("context window exceeded");
        return replies.shift() as ReturnType<typeof generated>;
      },
    });
    const executor = {
      async execute(run: Parameters<typeof source>[0]) {
        return execution(source(run));
      },
      async inspect(run: Parameters<typeof source>[0]) {
        return execution(source(run));
      },
    };

    const result = await loop.run(
      input(executor, ["list"], {
        history: {
          messages: [
            { role: "user", content: "old question" },
            { role: "assistant", content: "old answer" },
            { role: "user", content: "recent question" },
            { role: "assistant", content: "recent answer" },
          ],
        },
      }),
    );

    expect(result.response).toBe("Done after retry.");
    expect(requests[2]?.tools).toEqual([]);
    expect(requests[3]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: expect.stringContaining("<anchored-summary>"),
        }),
      ]),
    );
  });
});
