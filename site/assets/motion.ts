import { enableCipherFields } from "./cipher";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const easeOutExpo = (progress: number): number => (progress >= 1 ? 1 : 1 - 2 ** (-10 * progress));

function spring(duration: number, step: (eased: number) => void): void {
  const started = performance.now();
  const frame = (now: number) => {
    const progress = Math.min((now - started) / duration, 1);
    step(easeOutExpo(progress));
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function countUp(element: HTMLElement): void {
  const target = Number(element.dataset.count ?? "0");
  const suffix = element.dataset.countSuffix ?? "";
  if (target <= 0) return;
  spring(1400, (eased) => {
    element.textContent = `${Math.round(target * eased)}${suffix}`;
  });
}

function reveal(element: HTMLElement): void {
  const delay = Number(element.dataset.revealDelay ?? "0");
  window.setTimeout(() => {
    element.classList.add("is-revealed");
    for (const counter of element.querySelectorAll<HTMLElement>("[data-count]")) {
      countUp(counter);
    }
    if (element.dataset.count !== undefined) countUp(element);
  }, delay);
}

function observeReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (reducedMotion.matches) {
    for (const target of targets) target.classList.add("is-revealed");
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
  );
  for (const target of targets) observer.observe(target);
}

function trackPointer(element: HTMLElement, onMove: (x: number, y: number) => void): void {
  const reset = () => onMove(0, 0);
  element.addEventListener("pointermove", (event) => {
    const bounds = element.getBoundingClientRect();
    onMove(
      (event.clientX - bounds.left) / bounds.width - 0.5,
      (event.clientY - bounds.top) / bounds.height - 0.5,
    );
  });
  element.addEventListener("pointerleave", reset);
  element.addEventListener("blur", reset);
}

function enableMagnetic(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-magnetic]")) {
    trackPointer(element, (x, y) => {
      element.style.setProperty("--magnet-x", `${(x * 14).toFixed(2)}px`);
      element.style.setProperty("--magnet-y", `${(y * 10).toFixed(2)}px`);
    });
  }
}

function enableTilt(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-tilt]")) {
    trackPointer(element, (x, y) => {
      element.style.setProperty("--tilt-x", `${(y * -6).toFixed(2)}deg`);
      element.style.setProperty("--tilt-y", `${(x * 8).toFixed(2)}deg`);
      element.style.setProperty("--glow-x", `${(x * 100 + 50).toFixed(1)}%`);
      element.style.setProperty("--glow-y", `${(y * 100 + 50).toFixed(1)}%`);
    });
  }
}

function paintScroll(header: HTMLElement | null, layers: HTMLElement[]): void {
  const offset = window.scrollY;
  const height = document.documentElement.scrollHeight - window.innerHeight;
  document.documentElement.style.setProperty(
    "--scroll-progress",
    `${height > 0 ? Math.min(offset / height, 1) : 0}`,
  );
  header?.classList.toggle("is-condensed", offset > 24);
  for (const layer of layers) {
    const bounds = layer.getBoundingClientRect();
    const centered = (bounds.top + bounds.height / 2 - window.innerHeight / 2) / window.innerHeight;
    const depth = Number(layer.dataset.parallax ?? "12");
    layer.style.setProperty("--parallax-y", `${(centered * -depth).toFixed(2)}px`);
  }
}

function observeScroll(): void {
  const header = document.querySelector<HTMLElement>("[data-header]");
  const layers = reducedMotion.matches
    ? []
    : [...document.querySelectorAll<HTMLElement>("[data-parallax]")];
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paintScroll(header, layers);
    });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  schedule();
}

function start(): void {
  document.documentElement.classList.add("motion-ready");
  observeReveals();
  observeScroll();
  if (reducedMotion.matches) return;
  enableMagnetic();
  enableTilt();
  enableCipherFields();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
