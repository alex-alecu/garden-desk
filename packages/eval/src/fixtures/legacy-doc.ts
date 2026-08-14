import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { extract } from "tar-stream";

const ARCHIVE_SHA256 = "4415e79d9f4c8d282a1cffbdaffe7ec0178982b9608e79bfd18561234a43e0cc";
const DOCUMENT_SHA256 = "4ea5fe94a8ff9d8cd1e21a5e233efb681f2026de48ab1ac2cbaabdb953ca25ac";
const DOCUMENT_ENTRY = "antiword-0.37/Docs/testdoc.doc";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function documentBytes(archive: Buffer): Promise<Buffer> {
  const unpacker = extract();
  let document: Buffer | undefined;
  const completed = new Promise<Buffer>((resolve, reject) => {
    unpacker.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      stream.once("error", reject);
      stream.once("end", () => {
        if (header.name === DOCUMENT_ENTRY) document = Buffer.concat(chunks);
        next();
      });
    });
    unpacker.once("error", reject);
    unpacker.once("finish", () => {
      if (document === undefined) reject(new Error("Pinned Antiword DOC fixture is missing."));
      else resolve(document);
    });
  });
  unpacker.end(gunzipSync(archive));
  return await completed;
}

export async function createLegacyDocFixture(directory: string): Promise<number> {
  const archivePath = join(
    process.cwd(),
    "packages/workers/images/.generated/downloads/vault-antiword/antiword_0.37.orig.tar.gz",
  );
  const archive = await readFile(archivePath);
  if (sha256(archive) !== ARCHIVE_SHA256) throw new Error("Antiword source archive hash mismatch.");
  const document = await documentBytes(archive);
  if (sha256(document) !== DOCUMENT_SHA256) throw new Error("Antiword DOC fixture hash mismatch.");
  await writeFile(join(directory, "legacy-sample.doc"), document, { mode: 0o600 });
  return document.length;
}
