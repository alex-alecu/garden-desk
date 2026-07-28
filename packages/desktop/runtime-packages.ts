import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { nativeRuntimePackages } from "./src/runtime-package-contract.js";

interface PackageMetadata {
  name: string;
  dependencies?: Record<string, string>;
}

async function packageRoot(requireFrom: NodeRequire, name: string): Promise<string> {
  let current = dirname(requireFrom.resolve(name));
  while (current !== dirname(current)) {
    try {
      const metadata = JSON.parse(
        await readFile(join(current, "package.json"), "utf8"),
      ) as PackageMetadata;
      if (metadata.name === name) return current;
    } catch {
      // Keep walking to the package root.
    }
    current = dirname(current);
  }
  throw new Error(`Could not resolve package root for ${name}.`);
}

export async function copyRuntimePackage(
  name: string,
  requireFrom: NodeRequire,
  destinationModules: string,
  installed: Set<string>,
): Promise<void> {
  const source = await packageRoot(requireFrom, name);
  const metadata = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  ) as PackageMetadata;
  const destination = join(destinationModules, ...name.split("/"));
  if (installed.has(destination)) return;
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (path) => path === source || !path.startsWith(join(source, "node_modules")),
  });
  installed.add(destination);
  const nestedRequire = createRequire(join(source, "package.json"));
  const nestedModules = join(destination, "node_modules");
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    await copyRuntimePackage(dependency, nestedRequire, nestedModules, installed);
  }
  if (name === "node-llama-cpp") {
    for (const runtime of nativeRuntimePackages()) {
      await copyRuntimePackage(runtime, nestedRequire, destinationModules, installed);
    }
  }
}
