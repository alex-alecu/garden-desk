const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

interface ScanState {
  comment: boolean;
  escaped: boolean;
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

export function hasUnbalancedSourceDelimiters(source: string): boolean {
  const state: ScanState = { comment: false, escaped: false, quote: "", stack: [] };
  for (const character of source) {
    if (character === "\n") {
      state.comment = false;
      continue;
    }
    if (state.comment) continue;
    const valid =
      state.quote.length > 0 ? scanQuoted(character, state) : scanDelimiter(character, state);
    if (!valid) return true;
  }
  return state.quote.length > 0 || state.stack.length > 0;
}
