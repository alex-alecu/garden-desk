import { fileURLToPath } from "node:url";
import { cleanupDevelopmentModelOutput } from "./package-output-cleanup.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
await cleanupDevelopmentModelOutput(desktopRoot);
