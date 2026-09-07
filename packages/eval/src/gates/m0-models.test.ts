import { ModelManifestSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { readCanonicalModelManifest, verifyModelBytes } from "../models.js";

describe("M0 canonical model manifest", () => {
  it("accepts the committed hash-pinned assets", async () => {
    const manifest = await readCanonicalModelManifest();
    expect(manifest.models).toHaveLength(3);
  });

  it("rejects an unapproved ships transition", async () => {
    const manifest = await readCanonicalModelManifest();
    const changed = structuredClone(manifest);
    const firstModel = changed.models.at(0);
    if (!firstModel) {
      throw new Error("Canonical model manifest is empty");
    }
    firstModel.redistribution.status = "ships";
    expect(() => ModelManifestSchema.parse(changed)).toThrow(/requires explicit/u);
  });

  it("rejects a byte or hash mismatch", async () => {
    const manifest = await readCanonicalModelManifest();
    const firstModel = manifest.models.at(0);
    if (!firstModel) {
      throw new Error("Canonical model manifest is empty");
    }
    const model = { ...firstModel, byteLength: 3, sha256: "0".repeat(64) };
    expect(() => verifyModelBytes(model, Buffer.from("bad"))).toThrow(/SHA-256/u);
  });

  it("rejects duplicate identities and missing companion targets", async () => {
    const manifest = await readCanonicalModelManifest();
    const duplicate = structuredClone(manifest);
    const first = duplicate.models.at(0);
    const second = duplicate.models.at(1);
    if (first === undefined || second === undefined) throw new Error("Need two canonical models");
    second.id = first.id;
    second.companionFor = "missing-model";
    expect(() => ModelManifestSchema.parse(duplicate)).toThrow(/unique/u);
    expect(() => ModelManifestSchema.parse(duplicate)).toThrow(/companion target/u);
  });
});
