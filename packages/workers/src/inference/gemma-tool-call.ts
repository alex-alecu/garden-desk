import type { LlamaModel, Token } from "node-llama-cpp";
import { NATIVE_CALL_START, NATIVE_QUOTE } from "./gemma-native-format.js";

export type NativeTokenizer = Pick<LlamaModel, "tokenize" | "detokenize">;

export interface NativeToolCall {
  name: string;
  params: Record<string, unknown>;
}

/** A run of generated text between `<|"|>` tokens: structure text, or one complete string. */
interface Part {
  kind: "text" | "string";
  text: string;
}

class NativeCallSyntaxError extends Error {}

const DETOKENIZER_TRAIL = 8;
const NAME = /^[A-Za-z_][\w.-]*/u;
const LITERAL = /^(?:true|false|null|None)(?!\w)/u;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u;

function singleToken(model: NativeTokenizer, text: string): Token {
  const tokens = model.tokenize(text, true);
  const token = tokens[0];
  if (tokens.length !== 1 || token === undefined) throw new Error("gemma_native_token_missing");
  return token;
}

/** Reads `call:name{...}` from the parts; strings are already complete, so only structure is parsed. */
class NativeCallReader {
  private index = 0;
  private offset = 0;

  constructor(private readonly parts: readonly Part[]) {}

  call(): NativeToolCall {
    this.expect("call:");
    const name = this.match(NAME);
    const params = this.object();
    this.skipSpace();
    if (this.index < this.parts.length) throw new NativeCallSyntaxError();
    return { name, params };
  }

  private text(): string {
    const part = this.parts[this.index];
    return part?.kind === "text" ? part.text.slice(this.offset) : "";
  }

  private advance(length: number): void {
    this.offset += length;
    const part = this.parts[this.index];
    if (part !== undefined && this.offset >= part.text.length) {
      this.index += 1;
      this.offset = 0;
    }
  }

  private skipSpace(): void {
    const space = /^\s+/u.exec(this.text());
    if (space !== null) this.advance(space[0].length);
  }

  private peek(literal: string): boolean {
    this.skipSpace();
    return this.text().startsWith(literal);
  }

  private expect(literal: string): void {
    if (!this.peek(literal)) throw new NativeCallSyntaxError();
    this.advance(literal.length);
  }

  private match(pattern: RegExp): string {
    const found = pattern.exec(this.text());
    if (found === null) throw new NativeCallSyntaxError();
    this.advance(found[0].length);
    return found[0];
  }

  private string(): string | undefined {
    const part = this.parts[this.index];
    if (part?.kind !== "string") return undefined;
    this.index += 1;
    this.offset = 0;
    return part.text;
  }

  private value(): unknown {
    this.skipSpace();
    const string = this.string();
    if (string !== undefined) return string;
    if (this.text().startsWith("{")) return this.object();
    if (this.text().startsWith("[")) return this.array();
    const literal = LITERAL.exec(this.text());
    if (literal !== null) {
      this.advance(literal[0].length);
      return literal[0] === "true" ? true : literal[0] === "false" ? false : null;
    }
    return Number(this.match(NUMBER));
  }

  private object(): Record<string, unknown> {
    this.expect("{");
    const entries: [string, unknown][] = [];
    if (this.peek("}")) {
      this.advance(1);
      return {};
    }
    for (;;) {
      this.skipSpace();
      const key = this.string() ?? this.match(NAME);
      this.expect(":");
      entries.push([key, this.value()]);
      if (!this.peek(",")) break;
      this.advance(1);
    }
    this.expect("}");
    return Object.fromEntries(entries);
  }

  private array(): unknown[] {
    this.expect("[");
    const items: unknown[] = [];
    if (this.peek("]")) {
      this.advance(1);
      return items;
    }
    for (;;) {
      items.push(this.value());
      if (!this.peek(",")) break;
      this.advance(1);
    }
    this.expect("]");
    return items;
  }
}

function parseNativeToolCall(parts: readonly Part[]): NativeToolCall | undefined {
  try {
    return new NativeCallReader(parts).call();
  } catch (error) {
    if (error instanceof NativeCallSyntaxError) return undefined;
    throw error;
  }
}

/**
 * Splits the generated response at Gemma 4's tool-call token, keeps the prose before it for
 * streaming and storage, and parses the call body by token id: the `<|"|>` token delimits
 * strings, so a string keeps every byte the model generated, including any `"`.
 */
export class NativeToolCallCollector {
  private readonly start: Token;
  private readonly quote: Token;
  private readonly textTokens: Token[] = [];
  private callTokens: Token[] | undefined;

  constructor(private readonly model: NativeTokenizer) {
    this.start = singleToken(model, NATIVE_CALL_START);
    this.quote = singleToken(model, NATIVE_QUOTE);
  }

  /** Records one response chunk and returns the part of its text that precedes any call. */
  push(tokens: readonly Token[], text: string): string {
    if (this.callTokens !== undefined) {
      this.callTokens.push(...tokens);
      return "";
    }
    const index = tokens.indexOf(this.start);
    if (index < 0) {
      this.textTokens.push(...tokens);
      return text;
    }
    const before = tokens.slice(0, index);
    const visible = this.model.detokenize(before, false, this.textTokens);
    this.textTokens.push(...before);
    this.callTokens = tokens.slice(index + 1);
    return visible;
  }

  /**
   * Returns the prose and the parsed call. A call the reader rejects comes back as the
   * complete generated text, which Core rejects as raw protocol text and asks to redo.
   */
  finish(completeText: string): { text: string; call?: NativeToolCall } {
    const parts = this.parts();
    const call = parts === undefined ? undefined : parseNativeToolCall(parts);
    if (call === undefined) return { text: completeText };
    return { text: this.model.detokenize(this.textTokens, false), call };
  }

  private parts(): Part[] | undefined {
    const tokens = this.callTokens;
    if (tokens === undefined) return undefined;
    const parts: Part[] = [];
    let start = 0;
    let inString = false;
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== this.quote) continue;
      this.pushPart(parts, [start, index], inString);
      inString = !inString;
      start = index + 1;
    }
    if (inString) return undefined;
    this.pushPart(parts, [start, tokens.length], false);
    return parts;
  }

  private pushPart(parts: Part[], [from, to]: [number, number], inString: boolean): void {
    const tokens = this.callTokens ?? [];
    if (from === to && !inString) return;
    const trail = tokens.slice(Math.max(0, from - DETOKENIZER_TRAIL), from);
    const text = from === to ? "" : this.model.detokenize(tokens.slice(from, to), false, trail);
    parts.push({ kind: inString ? "string" : "text", text });
  }
}
