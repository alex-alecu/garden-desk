import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const imageRoot = join(process.cwd(), "packages/workers/images");

function enabledPackages(config: string): string[] {
  return config
    .split(/\r?\n/gu)
    .filter((line) => /^BR2_PACKAGE_[A-Z0-9_]+=y$/u.test(line))
    .sort();
}

describe("M3 cross-platform guest runtime", () => {
  it("enables the same Buildroot packages for macOS and Windows", async () => {
    const [macos, windows] = await Promise.all(
      ["aarch64", "x86_64"].map(async (architecture) =>
        readFile(
          join(
            imageRoot,
            "buildroot-external/configs",
            `garden_desk_agent_${architecture}_defconfig`,
          ),
          "utf8",
        ),
      ),
    );

    expect(enabledPackages(macos ?? "")).toEqual(enabledPackages(windows ?? ""));
  });

  it("uses one manifest version for every advertised runtime", async () => {
    const [manifestText, capabilitiesText] = await Promise.all([
      readFile(join(imageRoot, "agent/manifest.json"), "utf8"),
      readFile(join(imageRoot, "agent/capabilities.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      contents: Array<{ name: string; version: string }>;
    };
    const capabilities = JSON.parse(capabilitiesText) as {
      runtimes: Record<string, string>;
    };

    expect(capabilities.runtimes).toEqual(
      Object.fromEntries(manifest.contents.map(({ name, version }) => [name, version])),
    );
  });

  it("records the reproducible x86-64 agent image", async () => {
    const manifest = JSON.parse(await readFile(join(imageRoot, "agent/manifest.json"), "utf8")) as {
      outputs: { x86_64: { initramfsSha256: string } };
    };

    expect(manifest.outputs.x86_64.initramfsSha256).toBe(
      "452478a3997469786ebfe14471da2983b5417f3033089d6c5ca513c1c65a7b63",
    );
  });
});
