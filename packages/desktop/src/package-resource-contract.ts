export const packagedMigrationNames = [
  "0001-initial.sql",
  "0002-audit-head.sql",
  "0003-conversations.sql",
  "0004-agent.sql",
  "0005-agent-performance.sql",
  "0006-agent-workspace.sql",
  "0007-agent-executions.sql",
  "0008-agent-inference-traces.sql",
  "0009-folder-order.sql",
  "0010-agent-skill-request-traces.sql",
  "0011-agent-unbacked-response-traces.sql",
];

export function migrationNamesFromPaths(paths: readonly string[]): string[] {
  return paths
    .map((path) => path.split(/[\\/]/u).at(-1) ?? "")
    .filter((name) => /^\d{4}-.+\.sql$/u.test(name))
    .sort();
}
