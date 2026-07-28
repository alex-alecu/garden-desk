import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("M3 Windows package contract", () => {
  it("passes every packaged Windows runtime and guest resource to Core", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/desktop/src-tauri/src/main.rs"),
      "utf8",
    );
    for (const value of [
      "inference/worker.mjs",
      "inference/node.exe",
      "inference/vault-appcontainer-launcher.exe",
      "workers/vault-hcs-helper.exe",
      "workers/images",
      "--packaged-model-store",
    ]) {
      expect(source).toContain(value);
    }
  });

  it("produces one portable application with every backend and no online installer", async () => {
    const [configuration, staging, assets] = await Promise.all([
      readFile(join(process.cwd(), "packages/desktop/src-tauri/tauri.windows.conf.json"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/stage-windows-application.ts"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/windows-runtime-assets.json"), "utf8"),
    ]);
    expect(JSON.parse(configuration)).toEqual({ bundle: { active: false } });
    for (const value of [
      "windows-portable-directory",
      "Vault Desk.exe",
      "vault-core.exe",
      "resource-manifest.json",
      "nativeRuntimePackages()",
    ]) {
      expect(staging).toContain(value);
    }
    const cuda = JSON.parse(assets) as {
      cudaToolkitVersion: string;
      files: Array<{ destination: string }>;
    };
    expect(cuda.cudaToolkitVersion).toBe("13.1.0");
    expect(cuda.files.map((file) => file.destination)).toEqual([
      "cublas64_13.dll",
      "cublasLt64_13.dll",
      "NVIDIA-CUDA-LICENSE.txt",
    ]);
  });
});

describe("M3 Windows application authority", () => {
  it("requests the HCS administrator boundary at application launch", async () => {
    const manifest = await readFile(
      join(process.cwd(), "packages/desktop/src-tauri/windows-app-manifest.xml"),
      "utf8",
    );
    expect(manifest).toContain('level="requireAdministrator"');
  });
});
