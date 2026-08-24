// biome-ignore lint/style/noRestrictedImports: Test support starts isolated Node workers.
import { spawn } from "node:child_process";
import { once } from "node:events";
// biome-ignore lint/style/noRestrictedImports: Test support creates temporary diagnostic bundles.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const diagnosticSource = new URL("./development-diagnostics.ts", import.meta.url);
const workerSource = new URL("./worker.ts", import.meta.url);
const coreSource = new URL("../../../core/src/daemon/main.ts", import.meta.url);
const temporaryDirectories: string[] = [];
const desktopRequire = createRequire(
  fileURLToPath(new URL("../../../desktop/package.json", import.meta.url)),
);
const { build } = desktopRequire("esbuild") as {
  build(input: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
const productionCoreDefines = {
  "import.meta.url": '"file:///vault-core.cjs"',
  "globalThis.__VAULT_DEVELOPMENT_BUILD__": "false",
  "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": '""',
};

export async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vault-inference-diagnostics-"));
  temporaryDirectories.push(directory);
  return directory;
}

export async function cleanTemporaryDirectories(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
}

function diagnosticEntrySource(): string {
  return [diagnosticCaptureSource(), hostileDiagnosticSource()].join("\n");
}

function diagnosticCaptureSource(): string {
  return [
    'import { createDevelopmentDiagnosticSink, writeDevelopmentLlamaLog, writeDevelopmentOperationFailure } from "./development-diagnostics.js";',
    "export async function capture(chunks) {",
    "  const sink = createDevelopmentDiagnosticSink();",
    "  if (sink === undefined) return false;",
    "  for (const chunk of chunks) sink.append(Buffer.from(chunk));",
    "  await sink.close();",
    "  return true;",
    "}",
    "export function records() {",
    "  const records = [];",
    "  const write = process.stderr.write;",
    "  try {",
    "    process.stderr.write = (chunk) => { records.push(Buffer.from(chunk).toString('utf8')); return true; };",
    "    const error = new TypeError('private operation failure');",
    "    error.stack = 'stack=' + 's'.repeat(1024 * 1024);",
    "    error.cause = { reason: 'native failure', nested: { private: 'not recorded' } };",
    "    writeDevelopmentOperationFailure('chat', error);",
    "    writeDevelopmentLlamaLog('debug', 'raw llama log ' + 'l'.repeat(1024 * 1024));",
    "  } finally {",
    "    process.stderr.write = write;",
    "  }",
    "  return records;",
    "}",
  ].join("\n");
}

function hostileDiagnosticSource(): string {
  return [
    "export async function hostileDiagnostics() {",
    "  const sink = createDevelopmentDiagnosticSink();",
    "  if (sink === undefined) return false;",
    "  const write = process.stderr.write;",
    "  try {",
    "    process.stderr.write = () => true;",
    "    const hostile = new Proxy(new Error('private'), { get() { throw new Error('hostile getter'); }, getPrototypeOf() { throw new Error('hostile prototype'); } });",
    "    writeDevelopmentOperationFailure('chat', hostile);",
    "    writeDevelopmentLlamaLog(new Proxy({}, { get() { throw new Error('hostile level'); } }), new Proxy({}, { get() { throw new Error('hostile message'); } }));",
    "    sink.append(new Proxy(Buffer.from('private'), { get() { throw new Error('hostile chunk'); } }));",
    "    await sink.close();",
    "    return true;",
    "  } finally {",
    "    process.stderr.write = write;",
    "  }",
    "}",
  ].join("\n");
}

async function loadBundledDiagnostics(output: string) {
  return await import(`${pathToFileURL(output).href}?${Math.random()}`);
}

export async function bundledDiagnostics(developmentBuild: boolean, root: string) {
  const directory = await temporaryDirectory();
  const output = join(directory, "diagnostics.mjs");
  await build({
    bundle: true,
    define: {
      "globalThis.__VAULT_DEVELOPMENT_BUILD__": String(developmentBuild),
      "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": JSON.stringify(root),
    },
    format: "esm",
    minifySyntax: true,
    outfile: output,
    platform: "node",
    stdin: {
      contents: diagnosticEntrySource(),
      resolveDir: fileURLToPath(new URL(".", diagnosticSource)),
      sourcefile: "development-diagnostics-entry.ts",
    },
    target: "node24",
  });
  const diagnostics = await loadBundledDiagnostics(output);
  return {
    capture: diagnostics.capture as (chunks: string[]) => Promise<boolean>,
    hostileDiagnostics: diagnostics.hostileDiagnostics as () => Promise<boolean>,
    records: diagnostics.records as () => string[],
    source: await readFile(output, "utf8"),
  };
}

export async function bundledWorker(developmentBuild: boolean, output?: string): Promise<string> {
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    define: {
      "globalThis.__VAULT_DEVELOPMENT_BUILD__": String(developmentBuild),
      "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": '""',
    },
    entryPoints: [fileURLToPath(workerSource)],
    external: ["node-llama-cpp"],
    format: "esm",
    minifySyntax: true,
    platform: "node",
    target: "node24",
    ...(output === undefined ? { write: false } : { outfile: output }),
  });
  return output === undefined
    ? (result.outputFiles[0]?.text ?? "")
    : await readFile(output, "utf8");
}

export async function startedWorker(worker: string, failStderrWrite = false) {
  let entry = worker;
  if (failStderrWrite) {
    const directory = await temporaryDirectory();
    entry = join(directory, "stderr-write-failure.mjs");
    await writeFile(
      entry,
      [
        "process.stderr.write = () => { throw new Error('diagnostic write failure'); };",
        `await import(${JSON.stringify(pathToFileURL(worker).href)});`,
      ].join("\n"),
    );
  }
  const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
  child.stdout.resume();
  child.stdin.end();
  const [code] = await once(child, "close");
  return { code, stderr: Buffer.concat(stderr).toString("utf8") };
}

export async function bundledProductionCore(): Promise<string> {
  const result = await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    conditions: ["vault-runtime"],
    define: productionCoreDefines,
    entryPoints: [fileURLToPath(coreSource)],
    format: "cjs",
    minifySyntax: true,
    platform: "node",
    target: "node24",
    write: false,
  });
  return result.outputFiles[0]?.text ?? "";
}

interface EsbuildPluginBuild {
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: () => { contents: string; loader: "ts" },
  ): void;
  onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
}

const hostileRuntimePlugin = {
  name: "hostile-runtime",
  setup(pluginBuild: EsbuildPluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\/worker-runtime\.js$/ }, () => ({
      path: "hostile-runtime",
      namespace: "diagnostic-test",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "diagnostic-test" }, () => ({
      loader: "ts",
      contents: [
        "function hostileError() {",
        "  return new Proxy(new Error('private worker failure'), {",
        "    get() { throw new Error('hostile getter'); },",
        "    getPrototypeOf() { throw new Error('hostile prototype'); },",
        "  });",
        "}",
        "export async function runtime() {",
        "  throw hostileError();",
        "}",
        "export function chatSession() { throw hostileError(); }",
        "export function generationSession() { throw hostileError(); }",
      ].join("\n"),
    }));
  },
};

export async function bundledHostileWorker(): Promise<string> {
  const directory = await temporaryDirectory();
  const output = join(directory, "hostile-worker.mjs");
  await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    define: {
      "globalThis.__VAULT_DEVELOPMENT_BUILD__": "true",
      "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": '""',
    },
    entryPoints: [fileURLToPath(workerSource)],
    external: ["node-llama-cpp"],
    format: "esm",
    minifySyntax: true,
    platform: "node",
    plugins: [hostileRuntimePlugin],
    target: "node24",
    outfile: output,
  });
  return output;
}
