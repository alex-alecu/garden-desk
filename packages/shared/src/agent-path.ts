import { z } from "zod";

export const AgentWorkspacePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
    "unsafe_workspace_path",
  );

export const AgentSourcePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      value.startsWith("/source/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value
        .slice("/source/".length)
        .split("/")
        .every((part) => part.length > 0 && part !== "." && part !== ".."),
    "unsafe_source_path",
  );

export const AgentExecutionPathSchema = z.union([AgentWorkspacePathSchema, AgentSourcePathSchema]);

export type AgentWorkspacePath = z.infer<typeof AgentWorkspacePathSchema>;
export type AgentSourcePath = z.infer<typeof AgentSourcePathSchema>;
export type AgentExecutionPath = z.infer<typeof AgentExecutionPathSchema>;
