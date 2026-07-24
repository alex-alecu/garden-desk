import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/core/src/**/*.test.ts",
            "packages/core/tests/**/*.test.ts",
            "packages/cli/src/**/*.test.ts",
            "packages/workers/src/**/*.test.ts",
            "packages/desktop/src/**/*.test.ts",
            "packages/desktop/src/**/*.test.tsx",
            "packages/eval/src/gates/**/*.test.ts",
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
