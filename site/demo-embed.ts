const embeddedDemo = document.querySelector<HTMLIFrameElement>("[data-embedded-demo]");

if (embeddedDemo !== null) {
  const demoSource = embeddedDemo.dataset.src;
  const unsupportedViewport = window.matchMedia(
    "(max-width: 1119px), (hover: none) and (pointer: coarse)",
  );
  const syncInteraction = ({ matches }: MediaQueryList | MediaQueryListEvent) => {
    embeddedDemo.toggleAttribute("inert", matches);
    if (matches) {
      embeddedDemo.removeAttribute("src");
      embeddedDemo.setAttribute("aria-hidden", "true");
      embeddedDemo.tabIndex = -1;
    } else {
      if (demoSource !== undefined) embeddedDemo.setAttribute("src", demoSource);
      embeddedDemo.removeAttribute("aria-hidden");
      embeddedDemo.removeAttribute("tabindex");
    }
  };

  syncInteraction(unsupportedViewport);
  unsupportedViewport.addEventListener("change", syncInteraction);
}
