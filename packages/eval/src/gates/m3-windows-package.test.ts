import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("M3 Windows package contract", () => {
  it("passes every packaged Windows runtime and guest resource to Core", async () => {
    const source = (
      await Promise.all(
        ["main.rs", "core_arguments.rs"].map((name) =>
          readFile(join(process.cwd(), "packages/desktop/src-tauri/src", name), "utf8"),
        ),
      )
    ).join("\n");
    for (const value of [
      "inference/worker.mjs",
      "inference/node.exe",
      "inference/vault-appcontainer-launcher.exe",
      "inference/vision/llama-mtmd-cli.exe",
      "workers/vault-hcs-helper.exe",
      "workers/images",
      "--packaged-model-store",
    ]) {
      expect(source).toContain(value);
    }
  });
});

describe("M3 Windows portable package", () => {
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
      "canonicalGenerationModelPath",
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

describe("M3 Windows image runtime", () => {
  it("packages the exact application-local Visual C++ dependencies", async () => {
    const source = await readFile(join(process.cwd(), "assets/vision-runtime.json"), "utf8");
    const runtime = (
      JSON.parse(source) as {
        platforms: { "windows-vulkan-x64": { dependencies: Array<{ files: object }> } };
      }
    ).platforms["windows-vulkan-x64"];
    expect(Object.keys(runtime.dependencies[0]?.files ?? {})).toEqual([
      "msvcp140.dll",
      "vcruntime140.dll",
      "vcruntime140_1.dll",
    ]);
  });
});

describe("M3 model package input", () => {
  it("maps the canonical model pair only for model-bearing desktop commands", async () => {
    const [baseSource, packageSource, launcher] = await Promise.all([
      readFile(join(process.cwd(), "packages/desktop/src-tauri/tauri.conf.json"), "utf8"),
      readFile(
        join(process.cwd(), "packages/desktop/src-tauri/tauri.package-model.conf.json"),
        "utf8",
      ),
      readFile(join(process.cwd(), "packages/desktop/run-tauri.ts"), "utf8"),
    ]);
    const base = JSON.parse(baseSource) as { bundle: { resources: Record<string, string> } };
    const packageConfiguration = JSON.parse(packageSource) as {
      bundle: { resources: Record<string, string> };
    };
    expect(base.bundle.resources).not.toHaveProperty(
      "../../eval/.generated/models/gemma-4-12b-it-qat-q4_0.gguf",
    );
    expect(packageConfiguration.bundle.resources).toEqual({
      "resources/core/": "resources/core/",
      "../../eval/.generated/models/gemma-4-12b-it-qat-q4_0.gguf":
        "resources/core/models/gemma-4-12b-it-qat-q4_0.gguf",
      "../../eval/.generated/models/gemma-4-12b-it-qat-q4_0-mmproj.gguf":
        "resources/core/models/gemma-4-12b-it-qat-q4_0-mmproj.gguf",
      "../../../assets/fonts/LICENSE.txt": "assets/fonts/LICENSE.txt",
    });
    expect(launcher).toContain('tauriArguments[0] === "dev"');
    expect(launcher).toContain('tauriArguments[0] === "build"');
    expect(launcher).toContain('"tauri.package-model.conf.json"');
  });
});

describe("M3 Windows application authority", () => {
  it("keeps the application non-elevated and enforces setup natively", async () => {
    const [manifest, build, launcher, commands] = await Promise.all([
      readFile(join(process.cwd(), "packages/desktop/src-tauri/windows-app-manifest.xml"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/src-tauri/build.rs"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/run-tauri.ts"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/src-tauri/src/commands.rs"), "utf8"),
    ]);
    expect(manifest).toContain('level="asInvoker"');
    expect(manifest).not.toContain('level="requireAdministrator"');
    expect(launcher).not.toContain("--vault-windows-elevated-dev");
    expect(launcher).not.toContain("-Verb RunAs");
    expect(launcher).toContain('process.platform === "win32"');
    expect(launcher).toContain('tauriArguments[0] === "dev"');
    expect(launcher).toContain('tauriArguments.push("--no-watch")');
    expect(commands).toContain("crate::windows_setup::require_ready()?");
    expect(build).toContain(
      ["fn main() {", "    anchor_windows_package();", "    build_desktop();", "}"].join("\n"),
    );
  });
});

describe("M3 Windows setup helper", () => {
  it("builds and signs only the fixed Windows permission helper", async () => {
    const [signing, setup, setupArguments, resources, setupResource] = await Promise.all([
      readFile(join(process.cwd(), "packages/desktop/build-signing.ts"), "utf8"),
      readFile(
        join(process.cwd(), "packages/desktop/native/windows-hyper-v-setup/src/main.rs"),
        "utf8",
      ),
      readFile(
        join(
          process.cwd(),
          "packages/desktop/native/windows-hyper-v-setup/src/windows/arguments.rs",
        ),
        "utf8",
      ),
      readFile(join(process.cwd(), "packages/desktop/package-resources.ts"), "utf8"),
      readFile(join(process.cwd(), "packages/desktop/windows-setup-resource.ts"), "utf8"),
    ]);
    expect(signing).toContain("windowsSigningConfiguration");
    expect(signing).toContain("VAULT_SIGN_THUMBPRINT");
    expect(setupArguments).toContain('arguments[0] != "--requester-pid"');
    expect(setup).toContain("S-1-5-32-578");
    expect(setup).toContain("NetLocalGroupAddMembers");
    expect(resources).toContain("installWindowsSetupHelper");
    expect(setupResource).toContain("windowsSetupHelperSignature");
    expect(setupResource).toContain("vault-hyper-v-setup.exe");
  });
});
