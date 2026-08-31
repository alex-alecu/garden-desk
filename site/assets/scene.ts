import { reducedMotion, trackPointer } from "./motion";

const parallaxDepth: Record<string, number> = {
  house: 6,
  wall: 9,
  ground: 11,
  border: 14,
  desk: 16,
  branch: 26,
  foreground: 34,
};

function enableSceneParallax(scene: SVGSVGElement): void {
  const host = scene.parentElement;
  if (host === null || reducedMotion.matches) return;
  const layers = [...scene.querySelectorAll<SVGGElement>("[data-layer]")].filter(
    (layer) => parallaxDepth[layer.dataset.layer ?? ""] !== undefined,
  );
  trackPointer(host, (x, y) => {
    for (const layer of layers) {
      const depth = parallaxDepth[layer.dataset.layer ?? ""] ?? 0;
      layer.style.transform = `translate(${(x * depth).toFixed(2)}px, ${(y * depth * 0.45).toFixed(2)}px)`;
    }
  });
}

function preferredAppearance(): "day" | "night" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function describeControl(control: HTMLButtonElement, appearance: "day" | "night"): void {
  const night = appearance === "night";
  control.setAttribute("aria-pressed", String(night));
  control.setAttribute(
    "aria-label",
    night ? "Switch the garden to day" : "Switch the garden to night",
  );
  const label = control.querySelector<HTMLElement>("[data-appearance-label]");
  if (label !== null) label.textContent = night ? "Night" : "Day";
}

function enableAppearance(): void {
  const control = document.querySelector<HTMLButtonElement>("[data-appearance-toggle]");
  const apply = (appearance: "day" | "night") => {
    document.body.dataset.appearance = appearance;
    if (control !== null) describeControl(control, appearance);
  };
  apply(preferredAppearance());
  control?.addEventListener("click", () => {
    apply(document.body.dataset.appearance === "night" ? "day" : "night");
  });
}

function frameScene(scene: SVGSVGElement): void {
  const wide = window.matchMedia("(min-width: 901px)");
  const apply = () => {
    scene.setAttribute("viewBox", wide.matches ? "0 0 1600 700" : "742 0 676 700");
  };
  apply();
  wide.addEventListener("change", apply);
}

function start(): void {
  const scene = document.querySelector<SVGSVGElement>("[data-scene]");
  enableAppearance();
  if (scene === null) return;
  frameScene(scene);
  enableSceneParallax(scene);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
