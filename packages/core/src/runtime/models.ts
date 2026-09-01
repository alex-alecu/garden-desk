import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { InstalledModelStoreSchema } from "@gardendesk/shared";

export interface StagedModel {
  path: string;
  dispose(): Promise<void>;
}

export async function initializeEmptyModelStore(root: string): Promise<void> {
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const state = await lstat(root);
  const wrongOwner = process.getuid !== undefined && state.uid !== process.getuid();
  if (!state.isDirectory() || state.isSymbolicLink() || wrongOwner) {
    throw new Error("model_store_unsafe");
  }
  await chmod(root, 0o700);
  try {
    await writeFile(
      join(root, "installed-models.json"),
      `${JSON.stringify({ schemaVersion: 1, models: [] })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
async function digest(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}

export class ModelResolver {
  private constructor(
    private readonly root: string,
    private readonly store: ReturnType<typeof InstalledModelStoreSchema.parse>,
  ) {}

  static async open(root: string): Promise<ModelResolver> {
    const resolvedRoot = await realpath(resolve(root));
    const manifestPath = join(resolvedRoot, "installed-models.json");
    const manifestState = await lstat(manifestPath);
    if (!manifestState.isFile() || manifestState.isSymbolicLink()) {
      throw new Error("model_store_manifest_unsafe");
    }
    const store = InstalledModelStoreSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    return new ModelResolver(resolvedRoot, store);
  }

  async resolve(modelId: string, signal?: AbortSignal): Promise<StagedModel> {
    signal?.throwIfAborted();
    const model = this.store.models.find((candidate) => candidate.modelId === modelId);
    if (model === undefined) throw new Error("missing_model");
    const candidate = join(this.root, model.storeKey);
    const resolved = await realpath(candidate);
    signal?.throwIfAborted();
    const pathFromRoot = relative(this.root, resolved);
    if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith(".."))
      throw new Error("model_path_unsafe");
    const state = await lstat(candidate);
    if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1) {
      throw new Error("model_path_unsafe");
    }
    const stagedRoot = await mkdtemp(join(tmpdir(), "garden-desk-model-"));
    const stagedPath = join(stagedRoot, model.storeKey);
    try {
      signal?.throwIfAborted();
      await copyFile(resolved, stagedPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      signal?.throwIfAborted();
      const stagedState = await lstat(stagedPath);
      if (
        !stagedState.isFile() ||
        stagedState.isSymbolicLink() ||
        stagedState.nlink !== 1 ||
        stagedState.size !== model.byteLength ||
        (await digest(stagedPath, signal)) !== model.sha256
      ) {
        throw new Error("model_integrity_failed");
      }
      signal?.throwIfAborted();
      await chmod(stagedPath, 0o400);
      const resolvedStagedPath = await realpath(stagedPath);
      let disposed = false;
      return {
        path: resolvedStagedPath,
        async dispose() {
          if (disposed) return;
          disposed = true;
          await rm(stagedRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await rm(stagedRoot, { recursive: true, force: true });
      throw error;
    }
  }
}
