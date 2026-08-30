import type { InferenceStreamCallbacks } from "../runtime/inference.js";
import type { ChatAgentInput } from "./chat-loop-input.js";

export function streamCallbacks(
  input: ChatAgentInput,
  phase: "chat" | "compaction",
): InferenceStreamCallbacks {
  let thinking = "";
  let response = "";
  if (phase === "chat") input.onResponse?.(null);
  return {
    onThinkingDelta(delta) {
      thinking = `${thinking}${delta}`.slice(-64_000);
      input.onThinking?.(thinking);
    },
    ...(phase === "compaction"
      ? {}
      : {
          onResponseDelta(delta: string) {
            response += delta;
            if (response.trim().length > 0) input.onResponse?.(response);
          },
        }),
  };
}
