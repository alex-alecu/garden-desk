import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleComposerKeyDown } from "./components/composer.js";

function keyboardEvent({
  composing = false,
  key = "Enter",
  metaKey = true,
}: {
  composing?: boolean;
  key?: string;
  metaKey?: boolean;
}) {
  const preventDefault = vi.fn();
  const requestSubmit = vi.fn();
  const event = {
    currentTarget: { form: { requestSubmit } },
    key,
    metaKey,
    nativeEvent: { isComposing: composing },
    preventDefault,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  return { event, preventDefault, requestSubmit };
}

describe("composer keyboard shortcuts", () => {
  it("submits with Command-Enter", () => {
    const { event, preventDefault, requestSubmit } = keyboardEvent({});

    handleComposerKeyDown(event, true);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it.each([
    ["Enter alone", { metaKey: false }, true],
    ["another Command shortcut", { key: "a" }, true],
    ["IME composition", { composing: true }, true],
    ["disabled send", {}, false],
  ])("does not submit for %s", (_label, options, canSend) => {
    const { event, preventDefault, requestSubmit } = keyboardEvent(options);

    handleComposerKeyDown(event, canSend);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
