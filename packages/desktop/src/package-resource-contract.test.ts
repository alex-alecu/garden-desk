import { describe, expect, it } from "vitest";
import { migrationNamesFromPaths, packagedMigrationNames } from "./package-resource-contract.js";

describe("packaged migration resources", () => {
  it("includes every source migration in order", () => {
    expect(migrationNamesFromPaths(packagedMigrationNames)).toEqual(packagedMigrationNames);
    expect(packagedMigrationNames.at(-1)).toBe("0013-agent-tool-calling.sql");
  });
});
