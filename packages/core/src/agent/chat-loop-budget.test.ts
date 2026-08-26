import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

describe("ChatAgentLoop output spill budget", () => {
  it("counts spill processes before it accepts later model calls", async () => {
    const calls = Array.from({ length: 24 }, (_, index) =>
      tool("python", `spill-${index}`, { source: `print(${index})` }),
    );
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model([generated("", calls), generated("Done at the process limit.")], requests),
    );
    let primaryExecutions = 0;
    let spillExecutions = 0;

    const result = await loop.run(
      input(
        {
          async execute(run) {
            primaryExecutions += 1;
            const result = execution(source(run));
            result.stdout = primaryExecutions === 1 ? "x".repeat(60_000) : "done\n";
            return result;
          },
          async inspect(run) {
            spillExecutions += 1;
            return execution(source(run));
          },
        },
        ["python"],
      ),
    );

    expect(primaryExecutions).toBe(22);
    expect(spillExecutions).toBe(2);
    expect(result.executions).toHaveLength(22);
    expect(result.guestExecutions).toBe(24);
  });
});

describe("ChatAgentLoop guest runtime failure budget", () => {
  it("counts valid calls that reach a failing guest boundary", async () => {
    const calls = Array.from({ length: 25 }, (_, index) =>
      tool("python", `runtime-${index}`, { source: `print(${index})` }),
    );
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model([generated("", calls), generated("Done after runtime failures.")], requests),
    );
    const attempts: string[] = [];
    const events: string[] = [];

    const result = await loop.run(
      input(
        {
          async execute(run) {
            attempts.push(run.language === "shell" ? run.command : (run.source ?? run.path));
            throw new Error("agent_helper_transport_failed");
          },
        },
        ["python"],
        { onEvent: (type) => events.push(type) },
      ),
    );

    expect(result.response).toBe("Done after runtime failures.");
    expect(attempts).toHaveLength(24);
    expect(events.filter((type) => type === "execution.started")).toHaveLength(24);
  });
});
