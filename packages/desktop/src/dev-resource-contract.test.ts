import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { developmentResourceContract } from "./dev-resource-contract.js";

const desktopRoot = join("repository", "packages", "desktop");
const repositoryRoot = "repository";

describe("desktop development resource contract", () => {
  it("tracks the current primary prompt in packaged resources", () => {
    const contract = developmentResourceContract(desktopRoot, repositoryRoot, "win32", "x64");
    const primaryPrompt = join("prompts", "agents", "primary.md");
    expect(contract.requiredOutputs).toContain(
      join(desktopRoot, "src-tauri", "resources", "core", primaryPrompt),
    );
    expect(contract.requiredOutputs).not.toContain(
      join(desktopRoot, "src-tauri", "resources", "core", "prompts", "system", "agent.md"),
    );
  });

  it("requires only macOS runtime outputs on Apple silicon", () => {
    const contract = developmentResourceContract(desktopRoot, repositoryRoot, "darwin", "arm64");
    expect(contract.requiredOutputs).toContain(
      join(desktopRoot, "src-tauri", "resources", "core", "inference", "node"),
    );
    expect(contract.requiredOutputs.some((path) => path.endsWith("node.exe"))).toBe(false);
    expect(contract.requiredOutputs.some((path) => path.includes("win-x64"))).toBe(false);
    expect(contract.inputRoots.some((path) => path.includes("windows-appcontainer"))).toBe(false);
    expect(contract.requiredOutputs.some((path) => path.includes("hyper-v-setup"))).toBe(false);
    expect(contract.inputRoots.some((path) => path.endsWith("gemma-4-12b-it-qat-q4_0.gguf"))).toBe(
      true,
    );
    expect(
      contract.requiredOutputs.some((path) => path.endsWith("gemma-4-12b-it-qat-q4_0.gguf")),
    ).toBe(false);
  });
});

describe("desktop Windows development resource contract", () => {
  it("requires only Windows runtime outputs on Windows x64", () => {
    const contract = developmentResourceContract(desktopRoot, repositoryRoot, "win32", "x64");
    expect(contract.requiredOutputs).toContain(
      join(desktopRoot, "src-tauri", "resources", "core", "inference", "node.exe"),
    );
    expect(contract.requiredOutputs.some((path) => path.includes("mac-arm64-metal"))).toBe(false);
    expect(contract.requiredOutputs.some((path) => path.endsWith("garden-desk-vz-helper"))).toBe(
      false,
    );
    expect(contract.inputRoots.some((path) => path.includes("macos-vz-helper"))).toBe(false);
    expect(contract.requiredOutputs).toContain(
      join(
        desktopRoot,
        "src-tauri",
        "resources",
        "core",
        "windows",
        "garden-desk-hyper-v-setup.exe",
      ),
    );
  });
});
