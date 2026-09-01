import "./leaf-field";

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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

export function trackPointer(element: HTMLElement, onMove: (x: number, y: number) => void): void {
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

const HEADER_PINNED_ABOVE = 140;
const HEADER_HIDE_AFTER = 12;
const HEADER_REVEAL_AFTER = 50;

/**
 * Hide the bar on the way down and bring it back once the reader clearly means
 * to go up. Distance is accumulated per direction so trackpad jitter and
 * momentum wobble never flip it.
 */
function headerReveal(header: HTMLElement): (offset: number) => void {
  let last = window.scrollY;
  let up = 0;
  let down = 0;
  return (offset: number) => {
    const delta = offset - last;
    last = offset;
    if (delta > 0) {
      down += delta;
      up = 0;
    } else if (delta < 0) {
      up -= delta;
      down = 0;
    }
    if (offset <= HEADER_PINNED_ABOVE) {
      header.classList.remove("is-hidden");
      return;
    }
    if (down > HEADER_HIDE_AFTER) header.classList.add("is-hidden");
    else if (up > HEADER_REVEAL_AFTER) header.classList.remove("is-hidden");
  };
}

function paintScroll(layers: HTMLElement[], reveal: ((offset: number) => void) | undefined): void {
  const limit = document.documentElement.scrollHeight - window.innerHeight;
  // Rubber-band scrolling reports offsets outside the document on both ends.
  const offset = Math.min(Math.max(window.scrollY, 0), Math.max(limit, 0));
  document.documentElement.style.setProperty(
    "--scroll-progress",
    `${limit > 0 ? offset / limit : 0}`,
  );
  reveal?.(offset);
  for (const layer of layers) {
    const bounds = layer.getBoundingClientRect();
    const centered = (bounds.top + bounds.height / 2 - window.innerHeight / 2) / window.innerHeight;
    const depth = Number(layer.dataset.parallax ?? "12");
    layer.style.setProperty("--parallax-y", `${(centered * -depth).toFixed(2)}px`);
  }
}

function observeScroll(): void {
  const header = document.querySelector<HTMLElement>("[data-header]");
  const reveal = header === null ? undefined : headerReveal(header);
  const layers = reducedMotion.matches
    ? []
    : [...document.querySelectorAll<HTMLElement>("[data-parallax]")];
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paintScroll(layers, reveal);
    });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  // A page opened in a background tab schedules a frame that never runs, which
  // would leave the loop queued and the header stuck once the tab is opened.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    queued = false;
    schedule();
  });
  schedule();
}

function start(): void {
  document.documentElement.classList.add("motion-ready");
  observeReveals();
  observeScroll();
  if (reducedMotion.matches) return;
  enableTilt();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
