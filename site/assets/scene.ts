import type { GardenRenderer } from "./garden-renderer";

const screen = window.matchMedia("(min-width: 768px) and (min-height: 600px)");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

class GardenHero {
  private renderer: GardenRenderer | undefined;
  private loading = false;
  private failed = false;
  private paused = false;
  private visible = false;
  private readonly observer: IntersectionObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly button: HTMLButtonElement,
  ) {
    this.observer = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      void this.update();
    });
    this.observer.observe(host);
    screen.addEventListener("change", this.update);
    reduced.addEventListener("change", this.update);
    document.addEventListener("visibilitychange", this.update);
    window.addEventListener("pagehide", this.suspend);
    window.addEventListener("pageshow", this.update);
    button.addEventListener("click", () => {
      this.paused = !this.paused;
      button.textContent = this.paused ? "Resume animation" : "Pause animation";
      button.setAttribute("aria-pressed", String(this.paused));
      this.setRunning();
    });
  }

  private eligible(): boolean {
    return screen.matches && !reduced.matches && !this.failed;
  }

  private setRunning(): void {
    this.renderer?.setRunning(this.visible && !document.hidden && !this.paused);
  }

  private suspend = (): void => {
    this.renderer?.dispose();
    this.renderer = undefined;
    delete this.host.dataset.rendered;
    this.button.hidden = true;
  };

  private fail = (): void => {
    this.failed = true;
    this.suspend();
  };

  private update = async (): Promise<void> => {
    if (!this.eligible()) {
      this.suspend();
      return;
    }
    if (this.renderer) {
      this.setRunning();
      return;
    }
    if (this.loading || !this.visible || document.hidden) return;
    this.loading = true;
    try {
      const { mountGarden } = await import("./garden-renderer");
      if (!this.eligible() || !this.visible || document.hidden) return;
      this.renderer = mountGarden(this.host, this.fail);
      this.host.dataset.rendered = "true";
      this.button.hidden = false;
      this.setRunning();
    } catch {
      this.fail();
    } finally {
      this.loading = false;
    }
  };
}

const host = document.querySelector<HTMLElement>("[data-scene]");
const button = document.querySelector<HTMLButtonElement>("[data-garden-pause]");
if (host && button) new GardenHero(host, button);
