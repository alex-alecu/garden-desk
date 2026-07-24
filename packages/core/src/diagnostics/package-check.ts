import { spawnSync } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createDebugFixture, IDS } from "./session-fixture.js";

async function main(executable: string | undefined): Promise<void> {
  if (executable === undefined) throw new Error("Missing standalone Vault Core executable.");
  const fixture = await createDebugFixture();
  let snapshot: string | undefined;
  try {
    const result = spawnSync(
      executable,
      ["debug-session", "--database", fixture.databasePath, "--session", IDS.session],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...(process.platform === "darwin" ? { NODE_OPTIONS: "--jitless" } : {}),
        },
        maxBuffer: 8 * 1024,
        stdio: "pipe",
      },
    );
    snapshot = result.stdout.trim();
    if (
      result.status !== 0 ||
      result.stderr !== "" ||
      !isAbsolute(snapshot) ||
      snapshot.includes("\n") ||
      snapshot.includes("\r")
    ) {
      throw new Error("The standalone Vault Core diagnostic mode failed its package check.");
    }
    const session = await lstat(join(snapshot, "session.json"));
    if (!session.isFile()) throw new Error("The standalone debug snapshot is incomplete.");
  } finally {
    fixture.database.close();
    if (snapshot !== undefined && isAbsolute(snapshot)) {
      await rm(snapshot, { recursive: true, force: true });
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
}

void main(process.argv[2]);
