import { describe, expect, it } from "vitest";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { agentFailureEvent, agentFailureText, inferenceRunContext } from "./service-results.js";

describe("agent inference context", () => {
  it.each([
    { modelNeedsLoad: true, state: "unloaded" },
    { modelNeedsLoad: false, state: "ready" },
  ] as const)(
    "detects whether the $state model needs a load",
    async ({ modelNeedsLoad, state }) => {
      const context = await inferenceRunContext({
        async modelStatus() {
          return {
            contextSizeTokens: 65_536,
            modelId: "gemma-4-12b-it-qat-q4_0" as const,
            name: "Gemma 4 12B QAT",
            state,
            thinkingSupported: true,
          };
        },
      });

      expect(context).toEqual({ knownContextTokens: 65_536, modelNeedsLoad });
    },
  );
});

describe("agent failure privacy", () => {
  it("retains safe codes and removes host paths", () => {
    expect(agentFailureText(new Error("agent_helper_exited_1"))).toBe("agent_helper_exited_1");
    expect(agentFailureText(new Error("ENOENT: /private/tmp/customer/model.gguf"))).toBe(
      "agent_model_failed",
    );
    expect(agentFailureText(new Error("failed at /private/tmp/customer/source"))).toBe(
      "agent_run_failed",
    );
    expect(agentFailureText(new Error("missing_model"))).toBe("agent_model_failed");
    expect(agentFailureText(new Error("model_integrity_failed"))).toBe("agent_model_failed");
    expect(agentFailureText(new Error("combined_memory_budget_exceeded"))).toBe(
      "agent_memory_unavailable",
    );
    expect(agentFailureText(new InferenceFailure("out_of_memory", "Inference failed."))).toBe(
      "agent_memory_unavailable",
    );
  });

  it("reports planning stalls without claiming execution capacity was exhausted", () => {
    expect(agentFailureEvent(false, "agent_stalled_duplicate").summary).toBe(
      "The local model repeated the same program and could not make further progress.",
    );
    expect(agentFailureEvent(false, "agent_decision_limit_exceeded").summary).toBe(
      "The local model could not produce a new executable plan within the planning limit.",
    );
    expect(agentFailureEvent(false, "agent_generation_limit").summary).toBe(
      "The local model reached its output limit twice without completing the next action.",
    );
  });
});
