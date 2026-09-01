import { AgentSourcePathSchema, AgentWorkspacePathSchema } from "@gardendesk/shared";
import { object, textParam } from "./generic-tool-support.js";

export interface CodeParams {
  source?: string;
  path?: string;
}

function executionPath(path: string, hasSource: boolean): string {
  if (path.startsWith("/workspace/")) {
    return AgentWorkspacePathSchema.parse(path.slice("/workspace/".length));
  }
  if (path.startsWith("/source/")) {
    if (hasSource) throw new Error("source_mount_is_read_only");
    return AgentSourcePathSchema.parse(path);
  }
  if (path.startsWith("/")) throw new Error("unsupported_execution_path");
  return AgentWorkspacePathSchema.parse(path);
}

export function codeParams(value: unknown): CodeParams {
  const params = object(value);
  const source = params.source === undefined ? undefined : textParam(params, "source");
  const pathText = params.path === undefined ? undefined : textParam(params, "path", 1_000);
  if (source === undefined && pathText === undefined) throw new Error("source_or_path_required");
  const path = pathText === undefined ? undefined : executionPath(pathText, source !== undefined);
  return { ...(source === undefined ? {} : { source }), ...(path === undefined ? {} : { path }) };
}
