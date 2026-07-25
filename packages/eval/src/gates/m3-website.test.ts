import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps Tauri in the production adapter and injects it at the desktop entry", async () => {
  const root = process.cwd();
  const app = await readFile(join(root, "packages/desktop/src/app.tsx"), "utf8");
  const entry = await readFile(join(root, "packages/desktop/src/main.tsx"), "utf8");
  const adapter = await readFile(join(root, "packages/desktop/src/tauri-api.ts"), "utf8");
  const demo = await readFile(join(root, "site/demo/demo-api.ts"), "utf8");
  expect(app).not.toContain("@tauri-apps");
  expect(demo).not.toContain("@tauri-apps");
  expect(entry).toContain("<App api={tauriDesktopApi}");
  expect(adapter).toContain('invoke<unknown>("desktop_bootstrap")');
});
