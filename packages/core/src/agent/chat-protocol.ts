const PROTOCOL_FRAGMENT = /<\|?(?:tool_call|function_call)|<\/?tool_call\|?>/iu;

export function containsProtocolFragment(value: unknown): boolean {
  if (typeof value === "string") return PROTOCOL_FRAGMENT.test(value);
  if (Array.isArray(value)) return value.some(containsProtocolFragment);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).some(containsProtocolFragment);
}
