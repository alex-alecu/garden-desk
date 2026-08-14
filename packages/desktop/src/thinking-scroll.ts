export function followThinkingText(viewer: Pick<HTMLElement, "scrollHeight" | "scrollTop">): void {
  viewer.scrollTop = viewer.scrollHeight;
}
