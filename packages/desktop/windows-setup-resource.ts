import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { signExecutable } from "./build-signing.js";
import { reportDevelopmentResourceStage } from "./src/dev-resource-progress.js";
import type { ResourceHashes } from "./src/resource-hashes.js";

export async function installWindowsSetupHelper(options: {
  repositoryRoot: string;
  resourcesRoot: string;
  build: () => void;
  sha256: (path: string) => Promise<string>;
}): Promise<Pick<ResourceHashes, "windowsSetupHelper" | "windowsSetupHelperSignature">> {
  reportDevelopmentResourceStage("windowsPermissionSetup");
  options.build();
  const destinationRoot = join(options.resourcesRoot, "windows");
  await mkdir(destinationRoot, { recursive: true });
  const helper = join(destinationRoot, "garden-desk-hyper-v-setup.exe");
  await copyFile(
    join(
      options.repositoryRoot,
      "packages/desktop/native/windows-hyper-v-setup/.generated/garden-desk-hyper-v-setup.exe",
    ),
    helper,
  );
  const windowsSetupHelperSignature = signExecutable(helper);
  return {
    windowsSetupHelper: await options.sha256(helper),
    windowsSetupHelperSignature,
  };
}
