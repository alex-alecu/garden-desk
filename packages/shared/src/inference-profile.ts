export const INFERENCE_PROFILE = {
  modelId: "qwen3.8-27b-ud-iq4_xs",
  name: "Qwen3.8 27B Q4",
  projectorId: "qwen3.8-27b-mmproj-f16",
  contextTokens: 32_768,
  imageContextTokens: 8_192,
  imageTokens: 2_048,
  memoryBudgetBytes: 16 * 1024 ** 3,
  windowsDedicatedHostMemoryBytes: 20 * 1024 ** 3,
  minimumUnifiedMemoryBytes: 24 * 1024 ** 3,
  minimumDedicatedMemoryBytes: 16_000_000_000,
  runtimeBuild: "llama.cpp@b10816",
} as const;
