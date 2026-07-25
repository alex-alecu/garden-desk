import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi } from "./api.js";
import { App } from "./app.js";

it("disables native actions while keeping public demo examples visible", () => {
  const markup = renderToStaticMarkup(
    <App
      api={{} as DesktopApi}
      capabilities={{
        guidedExamples: [{ label: "Review transactions", prompt: "Review sample data" }],
        nativeActions: false,
        unavailableReason: "Unavailable in the public demo",
      }}
    />,
  );
  expect(markup).toContain("Try a guided example");
  expect(markup).toContain("Unavailable in the public demo");
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Add folder/s);
});
