import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

export async function prepareDevelopmentRuntimeOutput(desktopRoot: string): Promise<void> {
  const source = join(desktopRoot, "src-tauri", "resources", "core", "inference");
  const destination = join(
    desktopRoot,
    "src-tauri",
    "target",
    "debug",
    "resources",
    "core",
    "inference",
  );
  // Replace the files to discard macOS signature state cached for the old executables.
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
