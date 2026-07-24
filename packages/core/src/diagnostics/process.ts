import { isAbsolute } from "node:path";
import { DebugSessionError, type DebugSessionErrorCode } from "./errors.js";
import { removeSnapshot } from "./files.js";
import { createSessionDebugSnapshot } from "./session.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function diagnosticCode(error: unknown): DebugSessionErrorCode {
  return error instanceof DebugSessionError ? error.code : "debug_state_invalid";
}

export async function runDebugSessionMode(args: string[]): Promise<number> {
  const database = option(args, "--database");
  const session = option(args, "--session");
  if (
    args.length !== 5 ||
    args[0] !== "debug-session" ||
    args[1] !== "--database" ||
    args[3] !== "--session" ||
    database === undefined ||
    session === undefined
  ) {
    process.stderr.write("debug_arguments_invalid\n");
    return 2;
  }
  try {
    const path = await createSessionDebugSnapshot(database, session);
    if (!isAbsolute(path) || path.includes("\n") || path.includes("\r")) {
      await removeSnapshot(path);
      throw new DebugSessionError("debug_state_invalid");
    }
    process.stdout.write(`${path}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${diagnosticCode(error)}\n`);
    return 1;
  }
}
