// biome-ignore lint/style/noRestrictedImports: Core supplies a staged image; this boundary sends its bytes to the private server.
import { readFile } from "node:fs/promises";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import { completeChat } from "../inference/server-chat.js";
import { startServer } from "../inference/server-runtime.js";
import type { NativeWorkerLauncher } from "../native/launcher.js";

export interface VisionExecution {
  imagePath: string;
  memoryBudgetBytes: number;
  modelPath: string;
  projectorPath: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export class LlamaVisionClient {
  constructor(
    private readonly launcher: NativeWorkerLauncher,
    private readonly entryPath: string,
  ) {}

  async inspect(input: VisionExecution): Promise<{ text: string }> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(input.timeoutMs),
      ...(input.signal === undefined ? [] : [input.signal]),
    ]);
    signal.throwIfAborted();
    const image = await readFile(input.imagePath, { signal });
    const mediaType =
      image[0] === 0x89 ? "image/png" : image[0] === 0xff ? "image/jpeg" : "image/webp";
    const handle = await startServer(
      this.launcher,
      this.entryPath,
      { ...input, contextTokens: INFERENCE_PROFILE.imageContextTokens },
      signal,
    );
    try {
      const result = await completeChat(
        handle,
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` },
                },
              ],
            },
          ],
          max_tokens: INFERENCE_PROFILE.imageTokens,
          temperature: 0.7,
          top_p: 0.8,
          top_k: 20,
          min_p: 0,
          presence_penalty: 1.5,
          repeat_penalty: 1,
          chat_template_kwargs: { enable_thinking: false, preserve_thinking: false },
        },
        signal,
      );
      return { text: result.text };
    } finally {
      await handle.dispose();
    }
  }
}
