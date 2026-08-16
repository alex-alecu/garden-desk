import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@vault/shared": resolve("packages/shared/src/index.ts"),
          },
        },
        test: {
          name: "unit",
          // Several unit suites drive real SQLite catalogs, daemons, and temporary
          // workspaces. Windows runners exceed the 5 s default under load, and an
          // aborted test leaves its catalog open, so cleanup then fails with EBUSY.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          include: [
            "packages/core/src/**/*.test.ts",
            "packages/core/tests/**/*.test.ts",
            "packages/cli/src/**/*.test.ts",
            "packages/workers/src/**/*.test.ts",
            "packages/desktop/src/**/*.test.ts",
            "packages/desktop/src/**/*.test.tsx",
            "packages/eval/src/gates/**/*.test.ts",
            "packages/eval/src/stress/**/*.test.ts",
            "site/**/*.test.ts",
            "site/**/*.test.tsx",
          ],
          exclude: [
            "**/node_modules/**",
            "packages/eval/src/gates/m0-native.test.ts",
            "packages/eval/src/gates/m1-macos-native.test.ts",
            "packages/eval/src/gates/m1-windows-native.test.ts",
            "packages/eval/src/gates/m2-macos-native.test.ts",
            "packages/eval/src/gates/m2-windows-native.test.ts",
          ],
        },
      },
      {
        test: {
          name: "native",
          include: ["packages/eval/src/gates/m0-native.test.ts"],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "platform",
          include: [
            "packages/eval/src/gates/m1-macos-native.test.ts",
            "packages/eval/src/gates/m1-windows-native.test.ts",
          ],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "m2-native",
          include: [
            "packages/eval/src/gates/m2-macos-native.test.ts",
            "packages/eval/src/gates/m2-windows-native.test.ts",
          ],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
        },
      },
    ],
  },
});
