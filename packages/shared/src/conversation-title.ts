export function conversationTitle(content: string, attachmentName?: string): string {
  const command = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/u.exec(content.trim());
  const name = command?.[1]?.replaceAll("-", " ");
  if (name !== undefined) {
    const subject =
      attachmentName?.replace(/\.[^.]+$/u, "").replaceAll("_", " ") ?? command?.[2] ?? "";
    content = `${name.charAt(0).toUpperCase()}${name.slice(1)} ${subject}`;
  }
  return content.replaceAll(/\s+/gu, " ").trim().slice(0, 60);
}
