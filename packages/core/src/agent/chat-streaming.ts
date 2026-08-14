import type { InferenceStreamCallbacks } from "../runtime/inference.js";
import type { ChatAgentInput } from "./chat-loop-input.js";
import { visibleResponseText } from "./chat-protocol.js";

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
            const visible = visibleResponseText(response, true);
            if (visible.trim().length > 0) input.onResponse?.(visible);
          },
        }),
  };
}
