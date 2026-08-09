const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

interface ScanState {
  comment: boolean;
  escaped: boolean;
  multiline: boolean;
  quote: string;
  stack: string[];
}

function scanQuoted(character: string, state: ScanState): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (character === "\\") {
    state.escaped = true;
    return true;
  }
  if (character === state.quote) state.quote = "";
  return true;
}

function scanDelimiter(character: string, state: ScanState): boolean {
  if (character === "#") {
    state.comment = true;
    return true;
  }
  if (character === '"' || character === "'" || character === "`") {
    state.quote = character;
    return true;
  }
  if (character === "(" || character === "[" || character === "{") {
    state.stack.push(character);
    return true;
  }
  const expected = pairs[character];
  return expected === undefined || state.stack.pop() === expected;
}

/**
 * A backtick template or a triple-quoted Python block may span lines; a plain
 * single- or double-quoted string may not. Tracking the opening delimiter lets a
 * line break inside an ordinary string be reported as the malformed program it is.
 */
function spansLines(source: string, index: number, quote: string): boolean {
  if (quote === "`") return true;
  return source.startsWith(quote.repeat(3), index);
}

/** Reports an ordinary string left open at a line break as malformed. */
function scanLineBreak(state: ScanState): boolean {
  if (state.quote.length > 0 && !state.multiline && !state.escaped) return false;
  state.comment = false;
  state.escaped = false;
  return true;
}

/** Returns the extra characters consumed by an opening triple-quote block. */
function scanCharacter(source: string, index: number, state: ScanState): number | undefined {
  const character = source[index] as string;
  if (state.comment) return 0;
  const opening = state.quote.length === 0;
  const valid =
    state.quote.length > 0 ? scanQuoted(character, state) : scanDelimiter(character, state);
  if (!valid) return undefined;
  if (!opening || state.quote.length === 0) return 0;
  state.multiline = spansLines(source, index, state.quote);
  return state.multiline && state.quote !== "`" ? 2 : 0;
}

export function hasUnbalancedSourceDelimiters(source: string): boolean {
  const state: ScanState = {
    comment: false,
    escaped: false,
    multiline: false,
    quote: "",
    stack: [],
  };
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      if (!scanLineBreak(state)) return true;
      continue;
    }
    const consumed = scanCharacter(source, index, state);
    if (consumed === undefined) return true;
    index += consumed;
  }
  return state.quote.length > 0 || state.stack.length > 0;
}
