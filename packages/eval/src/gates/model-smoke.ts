import { getLlama, LlamaLogLevel } from "node-llama-cpp";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

function modelPathArgument(): string {
  const index = process.argv.indexOf("--model");
  const path = process.argv[index + 1];
  if (index === -1 || path === undefined) {
    throw new Error("Pass --model <path> for Qwen3-Embedding-0.6B-Q8_0.gguf.");
  }
  return path;
}

const path = modelPathArgument();
const manifest = await readCanonicalModelManifest();
const asset = manifest.models.find((model) => model.id === "qwen3-embedding-0.6b-q8_0");
if (asset === undefined) throw new Error("Canonical Qwen embedding asset is missing.");
await verifyModelFile(asset, path);

const llama = await getLlama({ logLevel: LlamaLogLevel.error });
try {
  const model = await llama.loadModel({ modelPath: path });
  try {
    const context = await model.createEmbeddingContext({ contextSize: 512 });
    try {
      const embedding = await context.getEmbeddingFor("Garden Desk offline retrieval smoke");
      if (embedding.vector.length === 0) throw new Error("Embedding vector is empty.");
      console.log(JSON.stringify({ modelId: asset.id, dimensions: embedding.vector.length }));
    } finally {
      await context.dispose();
    }
  } finally {
    await model.dispose();
  }
} finally {
  await llama.dispose();
}
