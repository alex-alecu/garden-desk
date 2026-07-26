const embeddedDemo = document.querySelector<HTMLIFrameElement>("[data-embedded-demo]");

if (embeddedDemo !== null) {
  const unsupportedViewport = window.matchMedia(
    "(max-width: 759px), (hover: none) and (pointer: coarse)",
  );
  const syncInteraction = ({ matches }: MediaQueryList | MediaQueryListEvent) => {
    embeddedDemo.toggleAttribute("inert", matches);
    if (matches) {
      embeddedDemo.setAttribute("aria-hidden", "true");
      embeddedDemo.tabIndex = -1;
    } else {
      embeddedDemo.removeAttribute("aria-hidden");
      embeddedDemo.removeAttribute("tabindex");
    }
  };

  syncInteraction(unsupportedViewport);
  unsupportedViewport.addEventListener("change", syncInteraction);
}
