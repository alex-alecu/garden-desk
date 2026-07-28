import type { AgentDecision, AgentExecutionResult, AgentInferenceOutcome } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { type AgentExecutor, AgentLoop } from "./loop.js";
import type { AgentTraceStore } from "./trace-store.js";

const performance = {
  promptTokens: 1,
  outputTokens: 1,
  promptDurationMs: 1,
  generationDurationMs: 1,
  totalDurationMs: 2,
};

const completed: AgentExecutionResult = {
  language: "python",
  path: "steps/0001.py",
  source: "print('ok')",
  command: null,
  exitCode: 0,
  stdout: "ok\n",
  stderr: "",
  durationMs: 1,
  termination: "completed",
  artifacts: [],
};

function inference(values: unknown[]): Pick<InferenceService, "generate"> {
  return {
    async generate() {
      const value = values.shift();
      if (value instanceof Error) throw value;
      return {
        protocolVersion: 1,
        requestId: "trace-test",
        status: "ok",
        operation: "generate",
        value,
        memory: {
          cpuRamBytes: 1,
          gpuVramBytes: 1,
          budgetBytes: 1,
          detectedGpuVramBytes: 1,
          contextSizeTokens: 8_192,
        },
        performance,
      };
    },
  };
}

function traceRecorder() {
  const outcomes: Array<{ outcome: AgentInferenceOutcome; execution?: number }> = [];
  const responses: unknown[] = [];
  let turn = 0;
  const store = {
    async begin() {
      return `turn-${turn++}`;
    },
    async captureResponse(_turnId: string, value: unknown) {
      responses.push(value);
    },
    recordOutcome(_turnId: string, outcome: AgentInferenceOutcome, executionSequence?: number) {
      outcomes.push({
        outcome,
        ...(executionSequence === undefined ? {} : { execution: executionSequence }),
      });
    },
  } as unknown as AgentTraceStore;
  return { store, outcomes, responses };
}

function executor(calls: string[]): AgentExecutor {
  return {
    async execute(input) {
      calls.push(input.language === "shell" ? input.command : input.source);
      if (input.language === "shell") {
        return {
          ...completed,
          language: "shell",
          path: null,
          source: null,
          command: input.command,
        };
      }
      return {
        ...completed,
        language: input.language,
        path: input.path,
        source: input.source,
        command: null,
      } as AgentExecutionResult;
    },
  };
}

function runInput(store: AgentTraceStore) {
  return {
    task: "Complete two steps",
    modelId: "gemma-4-12b-it-qat-q4_0",
    trace: { runId: "11111111-1111-4111-8111-111111111111", store },
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused cases cover one fail-closed trace boundary.
describe("AgentLoop fail-closed trace outcomes", () => {
  it("records a missing function call before the traced retry succeeds", async () => {
    const trace = traceRecorder();
    const result = await new AgentLoop(
      inference([
        new Error("structured_tool_call_required"),
        { action: "respond", response: "Recovered." },
      ]),
      executor([]),
    ).run(runInput(trace.store));

    expect(result.response).toBe("Recovered.");
    expect(trace.outcomes).toEqual([
      { outcome: "inference_failed" },
      { outcome: "accepted_response" },
    ]);
    expect(trace.responses).toEqual([{ action: "respond", response: "Recovered." }]);
  });

  it("records a generation limit before a bounded source recovery", async () => {
    const trace = traceRecorder();
    const calls: string[] = [];
    const execute: AgentDecision = {
      action: "execute",
      language: "python",
      source: "print('checkpoint')",
      summary: "Save one part",
    };
    const result = await new AgentLoop(
      inference([
        new Error("generation_token_limit"),
        execute,
        { action: "respond", response: "Recovered." },
      ]),
      executor(calls),
    ).run(runInput(trace.store));

    expect(result.response).toBe("Recovered.");
    expect(calls).toEqual([execute.source]);
    expect(trace.outcomes).toEqual([
      { outcome: "inference_failed" },
      { outcome: "accepted_execution", execution: 0 },
      { outcome: "accepted_response" },
    ]);
    expect(trace.responses).toEqual([execute, { action: "respond", response: "Recovered." }]);
  });

  it("records accepted, duplicate, and final response decisions before continuing", async () => {
    const calls: string[] = [];
    const trace = traceRecorder();
    const execute: AgentDecision = {
      action: "execute",
      language: "python",
      source: "print('ok')",
      summary: "Run",
    };
    const result = await new AgentLoop(
      inference([execute, execute, { action: "respond", response: "Done." }]),
      executor(calls),
    ).run(runInput(trace.store));

    expect(result.response).toBe("Done.");
    expect(calls).toEqual(["print('ok')"]);
    expect(trace.outcomes).toEqual([
      { outcome: "accepted_execution", execution: 0 },
      { outcome: "rejected_duplicate" },
      { outcome: "accepted_response" },
    ]);
    expect(trace.responses).toEqual([execute, execute, { action: "respond", response: "Done." }]);
  });

  it("records invalid structured values and inference failures", async () => {
    const invalid = traceRecorder();
    await expect(
      new AgentLoop(inference([{ action: "unknown" }]), executor([])).run(runInput(invalid.store)),
    ).rejects.toThrow();
    expect(invalid.outcomes).toEqual([{ outcome: "invalid_response" }]);
    expect(invalid.responses).toEqual([{ action: "unknown" }]);

    const failed = traceRecorder();
    await expect(
      new AgentLoop(inference([new Error("model_failed")]), executor([])).run(
        runInput(failed.store),
      ),
    ).rejects.toThrow("model_failed");
    expect(failed.outcomes).toEqual([{ outcome: "inference_failed" }]);
    expect(failed.responses).toEqual([]);
  });

  it("records cancellation while inference is active", async () => {
    const trace = traceRecorder();
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((accept) => {
      markStarted = accept;
    });
    const model: Pick<InferenceService, "generate"> = {
      async generate(_input, signal) {
        markStarted();
        return await new Promise((_accept, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const pending = new AgentLoop(model, executor([])).run({
      ...runInput(trace.store),
      signal: controller.signal,
    });
    await started;
    controller.abort(new DOMException("Cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(trace.outcomes).toEqual([{ outcome: "cancelled" }]);
  });

  it("never invokes inference after request capture failure", async () => {
    const generate = vi.fn(
      async () => await inference([{ action: "respond", response: "no" }]).generate({} as never),
    );
    const beginFailure = {
      begin: vi.fn(async () => {
        throw new Error("request_capture_failed");
      }),
    } as unknown as AgentTraceStore;
    await expect(
      new AgentLoop({ generate }, executor([])).run(runInput(beginFailure)),
    ).rejects.toThrow("request_capture_failed");
    expect(generate).not.toHaveBeenCalled();
  });

  it("never executes after response capture failure", async () => {
    const executeCalls: string[] = [];
    const responseFailure = {
      async begin() {
        return "turn";
      },
      async captureResponse() {
        throw new Error("response_capture_failed");
      },
      recordOutcome: vi.fn(),
    } as unknown as AgentTraceStore;
    await expect(
      new AgentLoop(
        inference([
          {
            action: "execute",
            language: "python",
            source: "print('unsafe')",
            summary: "Run",
          },
        ]),
        executor(executeCalls),
      ).run(runInput(responseFailure)),
    ).rejects.toThrow("response_capture_failed");
    expect(executeCalls).toEqual([]);
    expect(responseFailure.recordOutcome).not.toHaveBeenCalled();
  });

  it("never accepts a response after outcome capture failure", async () => {
    const outcomeFailure = {
      async begin() {
        return "turn";
      },
      async captureResponse() {},
      recordOutcome() {
        throw new Error("outcome_capture_failed");
      },
    } as unknown as AgentTraceStore;
    await expect(
      new AgentLoop(
        inference([{ action: "respond", response: "must not commit" }]),
        executor([]),
      ).run(runInput(outcomeFailure)),
    ).rejects.toThrow("outcome_capture_failed");
  });
});
