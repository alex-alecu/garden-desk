type ThinkingViewer = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;

export function followsThinkingText(viewer: ThinkingViewer): boolean {
  return viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight <= 50;
}

export function followThinkingText(
  viewer: Pick<HTMLElement, "scrollHeight" | "scrollTop">,
  follows = true,
): void {
  if (follows) viewer.scrollTop = viewer.scrollHeight;
}
