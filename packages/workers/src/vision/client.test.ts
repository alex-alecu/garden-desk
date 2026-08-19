import { describe, expect, it } from "vitest";
import { parseVisionOutput, visionRuntimeArguments, windowsVisionArguments } from "./client.js";

const input = {
  imagePath: "/tmp/image.png",
  memoryBudgetBytes: 12_000,
  modelPath: "/tmp/model.gguf",
  projectorPath: "/tmp/projector.gguf",
  prompt: "Read it.",
  timeoutMs: 1_000,
};

describe("llama vision client", () => {
  it("keeps only the final channel output", () => {
    expect(
      parseVisionOutput(
        "<|channel|>analysis<|message|>private<|channel|>final<|message|>Total: 42.75<|end|>",
      ),
    ).toBe("Total: 42.75");
    expect(parseVisionOutput("<|channel>thought\nprivate<channel|>Total: 42.75\n")).toBe(
      "Total: 42.75",
    );
  });

  it("builds fixed offline arguments without prompt text", () => {
    const args = visionRuntimeArguments(input, "/tmp/prompt.txt");
    expect(args).toContain("--offline");
    expect(args[args.indexOf("--file") + 1]).toMatch(/prompt\.txt$/u);
    expect(args).not.toContain(input.prompt);

    const windows = windowsVisionArguments({
      input,
      runtime: "/runtime/llama.exe",
      promptFile: "/tmp/prompt.txt",
      scratch: "/tmp",
    });
    expect(windows[0]).toBe("run-vision");
    expect(windows).not.toContain(input.prompt);
  });

  it("rejects output without a final channel", () => {
    expect(() => parseVisionOutput("analysis only")).toThrow("vision_final_response_missing");
  });
});

describe("Windows vision device selection", () => {
  it("passes the selected Vulkan device to the helper", () => {
    const args = windowsVisionArguments({
      input,
      runtime: "/runtime/llama.exe",
      promptFile: "/tmp/prompt.txt",
      scratch: "/tmp",
      vulkanDeviceIndex: 2,
    });
    expect(args[args.indexOf("--vulkan-device-index") + 1]).toBe("2");
  });

  it.each([-1, 1.5, 0x1_0000_0000])("rejects the numeric selector %s", (vulkanDeviceIndex) => {
    expect(() =>
      windowsVisionArguments({
        input,
        runtime: "/runtime/llama.exe",
        promptFile: "/tmp/prompt.txt",
        scratch: "/tmp",
        vulkanDeviceIndex,
      }),
    ).toThrow("invalid_windows_gpu_selection");
  });
});
