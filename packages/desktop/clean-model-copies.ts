import { fileURLToPath } from "node:url";
import { cleanModelCopies, packageBuildTarget } from "./package-output-cleanup.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const target = packageBuildTarget(desktopRoot, process.platform, process.arch, ["build"]);
if (target === undefined) throw new Error("Release model cleanup is unsupported on this platform.");
await cleanModelCopies(target);
console.log(JSON.stringify({ retainedPackage: target.packageRoot }));
