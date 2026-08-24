// biome-ignore lint/style/noRestrictedImports: this focused test helper runs the generated guest script.
import { execFile } from "node:child_process";
// biome-ignore lint/style/noRestrictedImports: this focused test helper creates guest input bytes.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { execution, source } from "./chat-loop-test-support.js";
import { GenericToolRegistry } from "./generic-tools.js";

const run = promisify(execFile);

export function readRegistry(runs: Parameters<AgentExecutor["execute"]>[0][]): GenericToolRegistry {
  return new GenericToolRegistry({
    executor: {
      async execute(run) {
        runs.push(run);
        return execution(source(run));
      },
      async inspect(run) {
        runs.push(run);
        return execution(source(run));
      },
    },
    skills: { metadata: () => [], read: () => "" },
  });
}

export async function readSource(params: Record<string, unknown>): Promise<string> {
  const runs: Parameters<AgentExecutor["execute"]>[0][] = [];
  const result = await readRegistry(runs).execute("read", params);
  expect(result).toMatchObject({ failed: false });
  expect(runs).toHaveLength(1);
  return source(runs[0] as (typeof runs)[number]);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused read fixture prepares and runs one guest program.
export async function executeRead(
  bytes: Uint8Array,
  params: Record<string, unknown> = {},
  options: {
    maximumSecondPassReads?: number;
    maximumWrite?: number;
    secondPassBytes?: Uint8Array;
  } = {},
) {
  const { maximumSecondPassReads, maximumWrite, secondPassBytes } = options;
  const root = await mkdtemp(join(tmpdir(), "vault-generic-read-"));
  try {
    await writeFile(join(root, "input"), bytes);
    const guestRoot = (await realpath(root)).replaceAll("\\", "/");
    const stdoutLimit =
      maximumWrite === undefined
        ? ""
        : [
            "class LimitedStdout:",
            "    def __init__(self, target): self.target = target",
            "    def write(self, text):",
            `        if len(text) > ${maximumWrite}: raise ValueError('read_output_not_streamed')`,
            "        return self.target.write(text)",
            "    def flush(self): return self.target.flush()",
            "sys.stdout = LimitedStdout(sys.stdout)",
          ].join("\n");
    const secondPassMutation =
      secondPassBytes === undefined
        ? ""
        : [
            "            with path.open('r+b') as updated:",
            "                updated.seek(0)",
            `                updated.write(bytes(${JSON.stringify([...secondPassBytes])}))`,
            "                updated.flush()",
          ].join("\n");
    const secondPassStream =
      maximumSecondPassReads === undefined
        ? "            stream(handle)"
        : [
            "            class LimitedReads:",
            "                def __init__(self, target): self.target, self.reads = target, 0",
            "                def read(self, size):",
            "                    self.reads += 1",
            `                    if self.reads > ${maximumSecondPassReads}: raise ValueError('read_range_scanned_to_eof')`,
            "                    return self.target.read(size)",
            "            stream(LimitedReads(handle))",
          ].join("\n");
    const script = (await readSource({ path: "input", ...params }))
      .replaceAll("/source", guestRoot)
      .replace(
        "resolved not in roots and not str(resolved).startswith(tuple(str(root) + '/' for root in roots))",
        "resolved not in roots and not any(resolved.is_relative_to(root) for root in roots)",
      )
      .replace("root = safe(args.get('path'))", `${stdoutLimit}\nroot = safe(args.get('path'))`)
      .replace(
        "            handle.seek(0)\n            stream(handle)",
        `            handle.seek(0)\n${secondPassMutation}\n${secondPassStream}`,
      );
    const path = join(root, "read.py");
    await writeFile(path, script);
    try {
      const result = await run(process.platform === "win32" ? "python" : "python3", [path], {
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      return { code: 0, stderr: result.stderr, stdout: result.stdout.replaceAll("\r\n", "\n") };
    } catch (error) {
      const result = error as { code?: number; stderr?: string; stdout?: string };
      return { code: result.code ?? 1, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
