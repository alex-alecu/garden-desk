import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { productionCapabilities } from "./capabilities.js";
import "./styles.css";
import { tauriDesktopApi } from "./tauri-api.js";

const root = document.getElementById("root");
if (root === null) throw new Error("Desktop root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App api={tauriDesktopApi} capabilities={productionCapabilities} />
  </StrictMode>,
);
