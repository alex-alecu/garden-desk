import type { PolicyDecision } from "@gardendesk/shared";

export function workspacePathDecision(withinScope: boolean): PolicyDecision {
  return withinScope
    ? { decision: "allow", reason: "within_workspace_scope" }
    : { decision: "deny", reason: "outside_workspace_scope" };
}

export function unsupportedOperation(): PolicyDecision {
  return { decision: "deny", reason: "unsupported_operation" };
}
