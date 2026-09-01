import { access, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stagePackedAgentInputs } from "./agent-staging.js";
import { copyBoundedInput } from "./staging.js";

const temporaryRoots: string[] = [];
const PACKED_LIMITS = {
  wallTimeMs: 1_000,
  inputCount: 64,
  inputBytes: 1024 * 1024,
  memoryBytes: 256 * 1024 * 1024,
  scratchBytes: 1024 * 1024,
  outputBytes: 1024,
  cpuCount: 1,
};

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "garden-desk-worker-stage-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("packed agent input staging", () => {
  it("packs many logical files into one read-only device", async () => {
    const root = await temporaryRoot();
    const inputs = await Promise.all(
      Array.from({ length: 37 }, async (_, index) => {
        const path = join(root, `source-${index}`);
        await writeFile(path, `input-${index}`);
        return { path, name: `folder/file-${index}.txt` };
      }),
    );
    const result = await stagePackedAgentInputs(
      inputs,
      root,
      PACKED_LIMITS,
      new AbortController().signal,
    );
    expect(result.devices).toHaveLength(1);
    expect(result.entries).toHaveLength(37);
    expect(result.entries[36]).toMatchObject({ deviceIndex: 0, byteOffset: 36 * 4096 });
    const volume = await open(result.devices[0] ?? "", "r");
    const bytes = Buffer.alloc(8);
    await volume.read(bytes, 0, bytes.length, result.entries[12]?.byteOffset ?? 0);
    await volume.close();
    expect(bytes.toString()).toBe("input-12");
  });
});

describe("bounded worker input staging", () => {
  it("removes a partial copy when the byte limit is exceeded", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    await writeFile(source, "oversized");
    await expect(
      copyBoundedInput(source, destination, 4, new AbortController().signal),
    ).rejects.toThrow("worker_input_limit_exceeded");
    await expect(access(destination)).rejects.toThrow();
  });

  it("does not create an output for a cancelled job", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    await writeFile(source, "input");
    const cancelled = AbortSignal.abort(new Error("cancelled"));
    await expect(copyBoundedInput(source, destination, 16, cancelled)).rejects.toThrow("cancelled");
    await expect(access(destination)).rejects.toThrow();
  });
});
