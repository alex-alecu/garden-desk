import type { ModelRuntimeStatus } from "@gardendesk/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import { TechnicalModelUsage } from "./technical-model-usage.js";

export function TechnicalOverviewTable({
  catalogPath,
  contextAllocatedTokens,
  contextUsedTokens,
  limits,
  model,
  sessionId,
}: {
  catalogPath: string;
  contextAllocatedTokens?: number | null | undefined;
  contextUsedTokens?: number | null | undefined;
  limits: string | undefined;
  model: ModelRuntimeStatus;
  sessionId: string | undefined;
}) {
  const { sourceMount, workspaceMount, runtimeMount } = capabilities;
  const rows = [
    ["Local session ID", sessionId ?? "No session selected"],
    ["Catalog path", catalogPath || "Not available"],
    [
      "Session folder",
      sessionId === undefined
        ? "No session selected"
        : `${workspaceMount.path} · read/write · ${workspaceMount.maximumBytes / 1024 ** 2} MiB`,
    ],
    ["Source mount", `${sourceMount.path} · ${sourceMount.mode} · live`],
    [
      "Temporary storage",
      `${runtimeMount.path} · ${runtimeMount.maximumBytes / 1024 ** 2} MiB · temporary`,
    ],
    ["Guest operating system", `Linux ${capabilities.runtimes.Linux}`],
    [
      "MicroVM limits",
      sessionId === undefined ? "No session selected" : (limits ?? "Not available"),
    ],
    ["MicroVM network access", "false"],
    ["Model", model.name],
    ["Model state", model.state],
  ];
  return (
    <table aria-label="Session technical details" className="technical-overview-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
        <TechnicalModelUsage
          contextAllocatedTokens={contextAllocatedTokens}
          contextUsedTokens={contextUsedTokens}
          model={model}
        />
      </tbody>
    </table>
  );
}
