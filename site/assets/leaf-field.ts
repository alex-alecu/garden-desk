const LEAF = "M0 0c13-15 37-15 50 0-13 15-37 15-50 0Z";
const COUNT = 18;
const SPACE = { width: 1600, height: 1000 };
const REACH = { x: 52, y: 30 };
const EASE = 0.075;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

interface Leaf {
  group: SVGGElement;
  depth: number;
  x: number;
  y: number;
}

/** Deterministic layout, so the field is identical on every load and every page. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function build(host: HTMLElement): Leaf[] {
  const next = sequence(20260901);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${SPACE.width} ${SPACE.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  const leaves: Leaf[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const depth = 0.25 + next() * 0.75;
    // The pointer moves the outer group through its transform attribute and the
    // ambient drift animates the inner one, so the two never contend.
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const drift = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", LEAF);
    path.setAttribute(
      "transform",
      `translate(${(next() * SPACE.width).toFixed(0)} ${(next() * SPACE.height).toFixed(0)}) rotate(${(next() * 360).toFixed(0)}) scale(${(0.7 + depth * 1.5).toFixed(2)})`,
    );
    drift.setAttribute("class", "leaf-drift");
    drift.append(path);
    group.setAttribute("class", "leaf-shift");
    group.style.opacity = (0.05 + depth * 0.07).toFixed(3);
    group.style.setProperty("--dur", `${(16 + next() * 18).toFixed(1)}s`);
    group.style.setProperty("--del", `${(next() * -20).toFixed(1)}s`);
    group.append(drift);
    svg.append(group);
    leaves.push({ group, depth, x: 0, y: 0 });
  }
  host.append(svg);
  return leaves;
}

function trackPointer(leaves: Leaf[]): void {
  let targetX = 0;
  let targetY = 0;
  let running = false;

  const step = () => {
    let settling = false;
    for (const leaf of leaves) {
      const toX = targetX * leaf.depth * REACH.x;
      const toY = targetY * leaf.depth * REACH.y;
      leaf.x += (toX - leaf.x) * EASE;
      leaf.y += (toY - leaf.y) * EASE;
      if (Math.abs(toX - leaf.x) > 0.2 || Math.abs(toY - leaf.y) > 0.2) settling = true;
      leaf.group.setAttribute("transform", `translate(${leaf.x.toFixed(2)} ${leaf.y.toFixed(2)})`);
    }
    running = settling;
    if (settling) requestAnimationFrame(step);
  };

  const wake = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(step);
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (reduced.matches) return;
      targetX = event.clientX / window.innerWidth - 0.5;
      targetY = event.clientY / window.innerHeight - 0.5;
      wake();
    },
    { passive: true },
  );

  // A hidden tab runs no animation frames, which would otherwise leave the loop
  // marked as running and the leaves frozen once the tab comes back.
  document.addEventListener("visibilitychange", () => {
    running = false;
    if (!document.hidden) wake();
  });
}

function start(): void {
  const host = document.querySelector<HTMLElement>("[data-leaf-field]");
  if (host === null) return;
  trackPointer(build(host));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
