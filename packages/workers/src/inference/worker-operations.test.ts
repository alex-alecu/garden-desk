import type { InferenceWorkerMessage } from "@gardendesk/shared";
import type { LlamaChatResponseChunk } from "node-llama-cpp";
import { describe, expect, it } from "vitest";
import { generationCallbacks } from "./worker-operations.js";

function chunk(text: string, segmentType?: "thought"): LlamaChatResponseChunk {
  return segmentType === undefined
    ? { type: undefined, segmentType: undefined, text, tokens: [] }
    : { type: "segment", segmentType, text, tokens: [] };
}

describe("inference worker text streams", () => {
  it("separates visible response text from typed thought text", () => {
    const messages: InferenceWorkerMessage[] = [];
    const callbacks = generationCallbacks("request", (message) => messages.push(message), true);

    callbacks.onResponseChunk(chunk("Visible answer."));
    callbacks.onResponseChunk(chunk("Private thought.", "thought"));

    expect(messages).toMatchObject([
      { status: "stream", event: "response.delta", text: "Visible answer." },
      { status: "stream", event: "thinking.delta", text: "Private thought." },
    ]);
  });

  it("does not expose structured generation JSON as response text", () => {
    const messages: InferenceWorkerMessage[] = [];
    generationCallbacks("request", (message) => messages.push(message)).onResponseChunk(
      chunk('{"result":'),
    );
    expect(messages).toEqual([]);
  });
});
