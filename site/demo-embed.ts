const homeDemo = document.querySelector<HTMLElement>("[data-home-demo]");
const embeddedDemo = homeDemo?.querySelector<HTMLIFrameElement>("[data-embedded-demo]");

if (homeDemo !== null && embeddedDemo !== null && embeddedDemo !== undefined) {
  const demoSource = embeddedDemo.dataset.src;
  const unsupportedViewport = window.matchMedia(
    "(max-width: 1119px), (hover: none) and (pointer: coarse)",
  );
  const syncInteraction = ({ matches }: MediaQueryList | MediaQueryListEvent) => {
    if (matches) {
      homeDemo.remove();
      unsupportedViewport.removeEventListener("change", syncInteraction);
      return;
    }
    if (demoSource !== undefined) embeddedDemo.setAttribute("src", demoSource);
    embeddedDemo.removeAttribute("inert");
    embeddedDemo.removeAttribute("aria-hidden");
    embeddedDemo.removeAttribute("tabindex");
    homeDemo.hidden = false;
  };

  syncInteraction(unsupportedViewport);
  if (!unsupportedViewport.matches) unsupportedViewport.addEventListener("change", syncInteraction);
}
