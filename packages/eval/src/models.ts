import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type ModelAsset, type ModelManifest, ModelManifestSchema } from "@gardendesk/shared";

const officialModelHost = "huggingface.co";

export async function readCanonicalModelManifest(): Promise<ModelManifest> {
  const path = join(process.cwd(), "assets", "models.json");
  return ModelManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export function modelDownloadUrl(model: ModelAsset): URL {
  if (model.source.host !== officialModelHost) throw new Error("Unapproved model host.");
  const path = `${model.source.repository}/resolve/${model.source.revision}/${model.source.file}`;
  return new URL(`https://${officialModelHost}/${path}`);
}

export function verifyModelBytes(model: ModelAsset, bytes: Uint8Array): void {
  if (bytes.byteLength !== model.byteLength) throw new Error("Model byte length mismatch.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== model.sha256) throw new Error("Model SHA-256 mismatch.");
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyModelFile(model: ModelAsset, path: string): Promise<void> {
  const details = await stat(path);
  if (details.size !== model.byteLength) throw new Error("Model byte length mismatch.");
  if ((await hashFile(path)) !== model.sha256) throw new Error("Model SHA-256 mismatch.");
}

function exactByteCount(expected: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      if (received > expected) {
        callback(new Error("Model download exceeded its declared byte length."));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(received === expected ? null : new Error("Model download byte length mismatch."));
    },
  });
}

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(600_000),
      });
      if (response.status < 500) return response;
      await response.body?.cancel();
      lastError = new Error(`Transient model-source response: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error("Model fetch failed after three transient upstream errors.", {
    cause: lastError,
  });
}

async function downloadToFile(model: ModelAsset, url: URL, path: string): Promise<void> {
  const response = await fetchWithRetry(url);
  if (!response.ok || response.body === null)
    throw new Error(`Model fetch failed: ${response.status}`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== model.byteLength) {
    throw new Error("Model response declared an unexpected byte length.");
  }
  const body = response.body as unknown as AsyncIterable<Uint8Array>;
  await pipeline(body, exactByteCount(model.byteLength), createWriteStream(path, { flags: "wx" }));
}

export async function fetchModel(model: ModelAsset, destination: string): Promise<void> {
  const temporaryPath = join(dirname(destination), `.${model.id}.tmp`);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await downloadToFile(model, modelDownloadUrl(model), temporaryPath);
    await verifyModelFile(model, temporaryPath);
    await link(temporaryPath, destination);
    await rm(temporaryPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
