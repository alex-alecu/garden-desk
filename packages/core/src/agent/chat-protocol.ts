const RAW_CALL_AFTER_OPENER =
  /<\|?(?:tool_call|function_call)>[\s\S]*(?:\bcall:[a-z_][\w.-]*|\b[a-z_][\w.-]*\s*\{\{)/iu;
const RAW_CALL_BEFORE_TERMINATOR =
  /(?:\bcall:[a-z_][\w.-]*|\b[a-z_][\w.-]*\s*\{\{)[\s\S]*(?:<tool_call\|>|<\/(?:tool_call|function_call)>)/iu;
const RAW_CALL_TERMINATOR_ONLY = /^\s*(?:<tool_call\|>|<\/(?:tool_call|function_call)>)\s*$/iu;
const PROTOCOL_TRANSITION =
  /(?:<tool_call\|>|<\/(?:tool_call|function_call)>)\s*(?:<\|(?:tool_call|function_call|channel|turn|return|think)\|?>|<(?:tool_call|function_call)>)/iu;
const LEAKED_TOOL_SUFFIX = /\}\}\s*(?:<tool_call\|>|<\/(?:tool_call|function_call)>)[\s\S]*$/iu;

export function containsRawProtocolCall(value: string): boolean {
  return (
    RAW_CALL_AFTER_OPENER.test(value) ||
    RAW_CALL_BEFORE_TERMINATOR.test(value) ||
    RAW_CALL_TERMINATOR_ONLY.test(value)
  );
}

export function containsProtocolTransition(value: unknown): boolean {
  if (typeof value === "string") return PROTOCOL_TRANSITION.test(value);
  if (Array.isArray(value)) return value.some(containsProtocolTransition);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).some(containsProtocolTransition);
}

/** Returns one complete leading JSON array only when a leaked tool-close suffix follows it. */
export function recoverJsonArrayBeforeProtocolTransition(value: string): string | undefined {
  const leaked = LEAKED_TOOL_SUFFIX.exec(value);
  if (leaked?.index === undefined || !containsProtocolTransition(leaked[0])) return undefined;
  const questions = value.slice(0, leaked.index).trim();
  return questions.startsWith("[") && questions.endsWith("]") ? questions : undefined;
}
