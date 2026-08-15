import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { visionResourceNames } from "../package-image-resources.js";

describe("desktop image runtime resources", () => {
  it("selects only the allowlisted files for each package target", async () => {
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "assets/vision-runtime.json"), "utf8"),
    );
    const mac = visionResourceNames(manifest, "macos-arm64");
    const windows = visionResourceNames(manifest, "windows-vulkan-x64");

    expect(mac).toContain("llama-mtmd-cli");
    expect(windows).toContain("llama-mtmd-cli.exe");
    expect(windows).toContain("libomp140.x86_64.dll");
    expect(windows).toContain("vcruntime140_1.dll");
    expect(new Set(windows).size).toBe(windows.length);
  });

  it("rejects a runtime file outside the generated runtime folder", () => {
    expect(() =>
      visionResourceNames(
        {
          platforms: {
            test: {
              executable: "runtime",
              files: { executable: "runtime", library: "../library" },
            },
          },
        },
        "test",
      ),
    ).toThrow("manifest is invalid");
  });
});
