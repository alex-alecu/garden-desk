import { describe, expect, it } from "vitest";
import { input } from "./chat-loop-test-support.js";
import { streamCallbacks } from "./chat-streaming.js";

describe("chat response stream formatting", () => {
  it("holds a protocol prefix until it can show only visible response text", () => {
    const responses: Array<string | null> = [];
    const callbacks = streamCallbacks(
      input(
        {
          async execute() {
            throw new Error("unused");
          },
        },
        [],
        { onResponse: (response) => responses.push(response) },
      ),
      "chat",
    );

    callbacks.onResponseDelta?.("<");
    callbacks.onResponseDelta?.('|"|>thought\n');
    callbacks.onResponseDelta?.("<channel|>Visible **answer");
    callbacks.onResponseDelta?.("**.");

    expect(responses).toEqual([null, "Visible **answer", "Visible **answer**."]);
  });
});
