import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationNamesFromPaths, packagedMigrationNames } from "./package-resource-contract.js";

describe("packaged migration resources", () => {
  it("includes every source migration in order", () => {
    const sourceNames = readdirSync(
      new URL("../../core/src/workspace/migrations/", import.meta.url),
    );
    expect(packagedMigrationNames).toEqual(migrationNamesFromPaths(sourceNames));
  });
});
