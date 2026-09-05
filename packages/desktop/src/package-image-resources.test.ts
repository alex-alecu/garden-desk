import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeResourceNames } from "../package-image-resources.js";

describe("desktop inference runtime resources", () => {
  it("selects only the allowlisted files for each package target", async () => {
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "assets/inference-runtime.json"), "utf8"),
    );
    const mac = runtimeResourceNames(manifest, "macos-arm64");
    const windows = runtimeResourceNames(manifest, "windows-vulkan-x64");

    expect(mac).toContain("llama-server");
    expect(windows).toContain("llama-server.exe");
    expect(windows).toContain("libomp.dll");
    expect(windows).toContain("vcruntime140_1.dll");
    expect(new Set(windows).size).toBe(windows.length);
  });

  it("rejects a runtime file outside the generated runtime folder", () => {
    expect(() =>
      runtimeResourceNames(
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
