import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildInferenceResources } from "./package-resources.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const destination = join(repositoryRoot, "packages/eval/.generated/windows-shared-gpu-inference");

console.log(JSON.stringify(await rebuildInferenceResources(destination)));
