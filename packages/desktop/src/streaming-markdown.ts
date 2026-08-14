export function stableStreamingMarkdown(text: string): string {
  const lines = text.split("\n");
  const last = lines.at(-1)?.trim() ?? "";
  if (/^(?:#{1,6}|>{1,3}|[-+*]|_{1,2}|~{1,2}|`{1,3}|\d+[.)])$/u.test(last)) {
    return lines.slice(0, -1).join("\n");
  }
  return text;
}
