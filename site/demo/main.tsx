import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../packages/desktop/src/app.js";
import type { DesktopCapabilities } from "../../packages/desktop/src/capabilities.js";
import "../../packages/desktop/src/styles.css";
import "./demo.css";
import { DemoDesktopApi } from "./demo-api.js";
import { guidedExamples } from "./demo-content.js";

const root = document.getElementById("root");
if (root === null) throw new Error("Demo root element is missing.");

const capabilities: DesktopCapabilities = {
  nativeActions: false,
  unavailableReason: "Unavailable in the public demo",
  guidedExamples,
};

createRoot(root).render(
  <StrictMode>
    <App api={new DemoDesktopApi()} capabilities={capabilities} />
  </StrictMode>,
);
