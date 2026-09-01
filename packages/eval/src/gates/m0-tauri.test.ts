import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const smokeRoot = join(process.cwd(), "packages/eval/src/platform/tauri-smoke");

describe("M0 Tauri capability surface", () => {
  it("grants the webview no shell, process, network, or filesystem plugin", async () => {
    const path = join(smokeRoot, "src-tauri/capabilities/default.json");
    const capability = JSON.parse(await readFile(path, "utf8")) as { permissions: string[] };
    expect(capability.permissions).toEqual(["core:default"]);
  });

  it("exposes one fixed no-argument sidecar command", async () => {
    const source = await readFile(join(smokeRoot, "src-tauri/src/main.rs"), "utf8");
    expect(source).toContain("async fn launch_test_sidecar(app: AppHandle)");
    expect(source).toContain('.sidecar("garden-desk-m0-sidecar")');
    expect(source).not.toMatch(/Command::new|\.args\(|https?:\/\//u);
  });

  it("makes the sidecar refuse all arguments", async () => {
    const source = await readFile(join(smokeRoot, "sidecar.ts"), "utf8");
    expect(source).toContain("process.argv.length !== 2");
  });

  it("publishes bounded runtime evidence through the existing core event channel", async () => {
    const source = await readFile(join(smokeRoot, "main.ts"), "utf8");
    const host = await readFile(join(smokeRoot, "src-tauri/src/main.rs"), "utf8");
    expect(source).toContain('.event.emit("m0-runtime-evidence", evidence)');
    expect(host).toContain('app.listen("m0-runtime-evidence"');
  });

  it("enforces the pinned Node version and records the source executable hash", async () => {
    const source = await readFile(join(smokeRoot, "build.ts"), "utf8");
    expect(source).toContain('expectedNodeVersion = "v24.18.0"');
    expect(source).toContain("nodeExecutableSha256");
  });
});
