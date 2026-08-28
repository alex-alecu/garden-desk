import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeAgentSession } from "@vault/workers";
import { requireM3ProductCheck } from "./m3-canonical-gate-reporting.js";
import { requireGuestSuccess } from "./m3-guest-execution.js";

const DIRECT_PYTHON = [
  "import json, pathlib",
  "path = pathlib.Path(__file__)",
  "before = path.read_text()",
  "blocked = False",
  "try:",
  "    path.write_text('changed')",
  "except OSError:",
  "    blocked = True",
  "print(json.dumps({'runtime': 'python', 'writeBlocked': blocked, 'unchanged': path.read_text() == before}))",
].join("\n");
const DIRECT_NODE = [
  "import fs from 'node:fs';",
  "const path = new URL(import.meta.url);",
  "const before = fs.readFileSync(path, 'utf8');",
  "let blocked = false;",
  "try { fs.writeFileSync(path, 'changed'); } catch { blocked = true; }",
  "console.log(JSON.stringify({runtime: 'node', writeBlocked: blocked, unchanged: fs.readFileSync(path, 'utf8') === before}));",
].join("\n");

export async function prepareDirectSourceFiles(source: string): Promise<void> {
  await writeFile(join(source, "direct.py"), DIRECT_PYTHON);
  await writeFile(join(source, "direct.mjs"), DIRECT_NODE);
}

export async function directSourceProbes(session: CodeAgentSession, source: string) {
  const evidence = [];
  for (const input of [
    { language: "python" as const, path: "/source/direct.py", content: DIRECT_PYTHON },
    { language: "node" as const, path: "/source/direct.mjs", content: DIRECT_NODE },
  ]) {
    const result = await session.execute({ language: input.language, path: input.path });
    requireGuestSuccess(result);
    const proof = JSON.parse(result.stdout) as {
      runtime: string;
      writeBlocked: boolean;
      unchanged: boolean;
    };
    requireM3ProductCheck(result.path === input.path, "Direct source path evidence is invalid.");
    requireM3ProductCheck(result.source === null, "Direct source call stored source text.");
    requireM3ProductCheck(proof.writeBlocked && proof.unchanged, "Direct source was writable.");
    const hostSource = await readFile(join(source, input.path.slice("/source/".length)), "utf8");
    requireM3ProductCheck(hostSource === input.content, "Direct source changed on the host.");
    evidence.push(proof);
  }
  return evidence;
}
