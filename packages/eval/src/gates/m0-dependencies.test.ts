import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pack } from "tar-stream";
import { Updater } from "tuf-js";
import { describe, expect, it } from "vitest";

async function deterministicTar(): Promise<Buffer> {
  const archive = pack();
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  archive.entry(
    { name: "manifest.json", mode: 0o644, mtime: new Date(0), uid: 0, gid: 0 },
    Buffer.from("{}\n"),
  );
  archive.finalize();
  return completed;
}

describe("M0 bundle dependency choices", () => {
  it("constructs byte-identical tar input with fixed metadata", async () => {
    expect(await deterministicTar()).toEqual(await deterministicTar());
  });

  it("loads the selected TUF verifier", () => {
    expect(Updater).toBeTypeOf("function");
  });

  it("verifies detached Ed25519 signatures with Node crypto", () => {
    const keys = generateKeyPairSync("ed25519");
    const payload = Buffer.from("garden-desk-bundle-manifest");
    const signature = sign(null, payload, keys.privateKey);
    expect(verify(null, payload, keys.publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.from("altered"), keys.publicKey, signature)).toBe(false);
  });

  it("assigns dependency, model, notice, and redistribution decisions", async () => {
    const path = join(process.cwd(), "compliance", "inventory.json");
    const inventory = JSON.parse(await readFile(path, "utf8")) as {
      owner: Record<string, string>;
      directDependencies: Array<{ name: string; version: string }>;
    };
    expect(Object.values(inventory.owner)).toEqual([
      "repository_owner",
      "repository_owner",
      "repository_owner",
      "repository_owner",
    ]);
    expect(inventory.directDependencies).toContainEqual({
      name: "typescript",
      version: "7.0.2",
      license: "Apache-2.0",
      use: "development",
    });
  });
});
