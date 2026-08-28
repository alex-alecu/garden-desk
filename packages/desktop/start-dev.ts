import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasWindowsStandardUserAuthority } from "./src/windows-dev-elevation.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
if (hasWindowsStandardUserAuthority(process.platform)) {
  const tauriArguments = process.platform === "win32" ? ["dev", "--no-watch"] : ["dev"];
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(desktopRoot, "run-tauri.ts"), ...tauriArguments],
    { cwd: desktopRoot, stdio: "inherit" },
  );
  if (result.error !== undefined) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.error(
    "[Garden Desk startup] Windows desktop development must run without administrator elevation.",
  );
  console.error("Close this terminal, open standard PowerShell, then run pnpm desktop:dev again.");
  process.exitCode = 1;
}
