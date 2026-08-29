import type { Token } from "node-llama-cpp";
import { describe, expect, it } from "vitest";
import { NativeToolCallCollector } from "./gemma-tool-call.js";

const CALL_START = 48 as Token;
const QUOTE = 52 as Token;
const TEXT_BASE = 1_000;

const model = {
  tokenize: (text: string) => [text === "<|tool_call>" ? CALL_START : QUOTE],
  detokenize: (tokens: readonly Token[]) =>
    tokens.map((token) => String.fromCodePoint(token - TEXT_BASE)).join(""),
};

function text(value: string): Token[] {
  return [...value].map((character) => ((character.codePointAt(0) ?? 0) + TEXT_BASE) as Token);
}

describe("Gemma native tool call", () => {
  it("retains the protocol marker when a generated call is invalid", () => {
    const collector = new NativeToolCallCollector(model);

    collector.push(
      [...text("Reading."), CALL_START, ...text("call:python{source:")],
      "Reading.<|tool_call>call:python{source:",
    );

    expect(collector.finish("Reading.call:python{source:")).toEqual({
      text: "Reading.<|tool_call>call:python{source:",
    });
  });

  it("keeps a double quote inside a generated string argument", () => {
    const collector = new NativeToolCallCollector(model);
    const source = 'value = cell.replace("€", "").replace(" ", "")';

    const visible = collector.push(
      [...text("Reading."), CALL_START, ...text("call:python{source:"), QUOTE],
      'Reading.<|tool_call>call:python{source:<|"|>',
    );
    collector.push(
      [
        ...text(source),
        QUOTE,
        ...text(", path:"),
        QUOTE,
        ...text("steps/0001.py"),
        QUOTE,
        ...text("}"),
      ],
      "",
    );

    expect(visible).toBe("Reading.");
    expect(collector.finish("unused")).toEqual({
      text: "Reading.",
      call: { name: "python", params: { source, path: "steps/0001.py" } },
    });
  });
});
