import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps Tauri in the production adapter and injects it at the desktop entry", async () => {
  const root = process.cwd();
  const app = await readFile(join(root, "packages/desktop/src/app.tsx"), "utf8");
  const entry = await readFile(join(root, "packages/desktop/src/main.tsx"), "utf8");
  const adapter = await readFile(join(root, "packages/desktop/src/tauri-api.ts"), "utf8");
  const bridge = await readFile(join(root, "packages/desktop/src/development-errors.ts"), "utf8");
  const demo = await readFile(join(root, "site/demo/demo-api.ts"), "utf8");
  expect(app).not.toContain("@tauri-apps");
  expect(demo).not.toContain("@tauri-apps");
  expect(entry).toContain("<App api={tauriDesktopApi}");
  expect(adapter).toContain('invokeDesktop("desktop_bootstrap", parseBootstrap)');
  expect(bridge).toContain("invoke<unknown>(command, args)");
});

it("pins the self-hosted IBM Plex font assets", async () => {
  const fontHashes = {
    "IBMPlexMono-Regular.woff2": "ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350",
    "IBMPlexSans-Bold.woff2": "fa7130d854a660b39a7fc9e6e0f2dc23dba5f1346e2adea3e1fe37b6d884133d",
    "IBMPlexSans-Medium.woff2": "5660f8a658f8bb50dbc005232f885eadffd2bc1c235c4f6fbb63469d1f9cde6d",
    "IBMPlexSans-Regular.woff2": "ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a",
    "IBMPlexSans-SemiBold.woff2":
      "f78048030eab62e860efa39a0df79e2e5581bf122eb95b9bc42c0b8a4988d205",
    "IBMPlexSerif-Italic.woff2": "ba5feed9ebae36e3b6ae3486052c90f4f42a294fa67a7c9415985175d19c4c82",
    "IBMPlexSerif-Regular.woff2":
      "024ebce13cec984b46e350dd85fa7c01105c777e116bfe95f097ad7fa93f39f2",
    "IBMPlexSerif-SemiBold.woff2":
      "030d808e82f99ebe5c21d50745bd06e5ce16ad9e94b360f5adcc19362beb5344",
  } as const;

  for (const [name, expected] of Object.entries(fontHashes)) {
    const bytes = await readFile(join(process.cwd(), "assets/fonts", name));
    expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(expected);
  }
});
