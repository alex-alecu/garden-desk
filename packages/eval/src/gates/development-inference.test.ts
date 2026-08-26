import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDevelopmentHeadlessEntry,
  prepareDevelopmentDiagnosticRoot,
  requireHeadlessExitStatus,
  runDevelopmentHeadlessEntry,
} from "./development-inference.js";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";

const HEADLESS_ENTRIES = [
  "m3-macos-agent.ts",
  "m3-windows-agent.ts",
  "m3-windows-memory.ts",
  "m3-professional-skills.ts",
  "../stress/m3-small.ts",
  "../stress/m3-context-session.ts",
  "../stress/m3-scaled.ts",
] as const;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

function developmentHeadlessRoot(): string {
  return join(process.cwd(), "packages", "eval", ".generated", "development-inference-headless");
}

async function legacyDiagnosticFixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-legacy-diagnostic-"));
  const obsolete = join(root, "headless");
  const run = join(root, "00000000-0000-4000-8000-000000000001");
  const log = join(run, "worker-stderr.log");
  await Promise.all([mkdir(obsolete, { recursive: true }), mkdir(run, { recursive: true })]);
  await Promise.all([writeFile(join(obsolete, "old.mjs"), "old"), writeFile(log, "fixed")]);
  return { log, obsolete, root, run };
}

describe("development headless inference worker", () => {
  it("uses an ignored development worker outside a macOS production resource path", () => {
    expect(developmentInferenceWorkerEntryPath("darwin")).toBe(
      join(
        process.cwd(),
        "packages",
        "workers",
        ".generated",
        "development-inference",
        "worker.mjs",
      ),
    );
  });

  it("keeps the Windows development worker beside the staged runtime", () => {
    const root = join("C:", "Vault", "resources", "core", "inference");
    expect(developmentInferenceWorkerEntryPath("win32", root)).toBe(
      join(root, ".generated", "development-inference", "worker.mjs"),
    );
  });
});

describe("development diagnostic root migration", () => {
  it("removes only the obsolete diagnostic headless tree", async () => {
    const fixture = await legacyDiagnosticFixture();
    try {
      await prepareDevelopmentDiagnosticRoot(fixture.root);

      await expect(stat(fixture.obsolete)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(fixture.run)).resolves.toBeDefined();
      await expect(stat(fixture.log)).resolves.toBeDefined();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe("development headless process result", () => {
  it("rejects a headless process that ends without an exit status", () => {
    expect(() => requireHeadlessExitStatus({ status: null })).toThrow(
      "development_headless_terminated",
    );
  });
});

describe("development headless Core build", () => {
  it("builds every M3 and stress entry with fixed development definitions", async () => {
    const outputs = await Promise.all(
      HEADLESS_ENTRIES.map(
        async (path) => await buildDevelopmentHeadlessEntry(new URL(path, import.meta.url)),
      ),
    );
    try {
      const sources = await Promise.all(outputs.map(async (path) => await readFile(path, "utf8")));
      expect(dirname(outputs[0] as string)).toBe(developmentHeadlessRoot());
      await expect(
        stat(join(dirname(outputs[0] as string), "migrations", "0001-initial.sql")),
      ).resolves.toBeDefined();
      for (const source of sources) {
        expect(source).toContain("inference-diagnostics");
        expect(source).toContain("development-inference");
        expect(source).not.toContain("Dynamic require of");
        expect(source).not.toContain('from "esbuild"');
        expect(source).not.toContain("__VAULT_DEVELOPMENT_BUILD__ =");
        expect(source).not.toContain("__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__ =");
      }
    } finally {
      await Promise.all(outputs.map(async (path) => await rm(path, { force: true })));
    }
  });

  it("reports a safe typed harness failure when entry build fails", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runDevelopmentHeadlessEntry(
      new URL("./missing-development-entry.ts", import.meta.url),
      "m3_test_entry_failed",
    );
    const serialized = output.mock.calls
      .map((call) => String(call[0]))
      .find((value) => value.includes("m3_test_entry_failed"));
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized as string)).toEqual({
      classification: "m3_test_entry_failed",
      failureClass: "harness_failure",
      evidenceReference: "report.failure",
      failure: { code: "m3_fixture_failure", stage: "fixture" },
    });
    expect(serialized).not.toContain("missing-development-entry.ts");
    expect(process.exitCode).toBe(1);
  });
});
