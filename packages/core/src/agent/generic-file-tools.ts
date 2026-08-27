import { randomUUID } from "node:crypto";
import { AgentWorkspacePathSchema } from "@vault/shared";
import { type EditName, editSource } from "./generic-edit-source.js";
import {
  inspectionTools,
  object,
  objectSchema,
  runExecution,
  type ToolSpec,
  textParam,
} from "./generic-tool-support.js";

const MAX_CONTENT_CHARS = 24_000;
const MAX_TEXT_CHARS = 12_000;

function workspacePath(params: Record<string, unknown>): string {
  const requested = textParam(params, "path", 4_096);
  const absolute = requested.startsWith("/") ? requested : `/workspace/${requested}`;
  const relative = absolute.slice("/workspace/".length);
  if (
    !absolute.startsWith("/workspace/") ||
    !AgentWorkspacePathSchema.safeParse(relative).success
  ) {
    throw new Error("unsupported_path: write and edit change only files under /workspace");
  }
  return absolute;
}

function bodyText(params: Record<string, unknown>, name: string, maximum: number): string {
  const item = params[name];
  if (typeof item !== "string" || item.length > maximum)
    throw new Error(`invalid_${name}: use text with at most ${maximum} characters`);
  return item;
}

function replaceAllParam(params: Record<string, unknown>): boolean {
  const item = params.replace_all;
  if (item === undefined) return false;
  if (typeof item !== "boolean") throw new Error("invalid_replace_all: use true or false");
  return item;
}

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function fileExecution(name: EditName, encoded: Record<string, unknown>) {
  return {
    language: "python" as const,
    path: `.vault-tools/${name}-${randomUUID()}.py`,
    source: editSource(name, encoded),
  };
}

function writeParams(value: unknown) {
  const params = object(value);
  return { path: workspacePath(params), content: bodyText(params, "content", MAX_CONTENT_CHARS) };
}

function writeTool(): ToolSpec {
  return {
    definition: {
      name: "write",
      description: "Create or overwrite a /workspace file with exact UTF-8 text.",
      params: objectSchema({ path: { type: "string" }, content: { type: "string" } }, [
        "path",
        "content",
      ]),
    },
    parse: writeParams,
    execute: async (value, context) => {
      const params = value as ReturnType<typeof writeParams>;
      return await runExecution(
        context,
        fileExecution("write", { path: params.path, content: base64(params.content) }),
        false,
      );
    },
  };
}

function editParams(value: unknown) {
  const params = object(value);
  return {
    path: workspacePath(params),
    old: textParam(params, "old", MAX_TEXT_CHARS),
    new: bodyText(params, "new", MAX_TEXT_CHARS),
    replace_all: replaceAllParam(params),
  };
}

function editTool(): ToolSpec {
  return {
    definition: {
      name: "edit",
      description:
        "Replace exact text in a /workspace file; old must match once unless replace_all.",
      params: objectSchema(
        {
          path: { type: "string" },
          old: { type: "string" },
          new: { type: "string" },
          replace_all: { type: "boolean" },
        },
        ["path", "old", "new"],
      ),
    },
    parse: editParams,
    execute: async (value, context) => {
      const params = value as ReturnType<typeof editParams>;
      return await runExecution(
        context,
        fileExecution("edit", {
          path: params.path,
          old: base64(params.old),
          new: base64(params.new),
          replace_all: params.replace_all,
        }),
        false,
      );
    },
  };
}

export function guestFileTools(): ToolSpec[] {
  return [...inspectionTools(), writeTool(), editTool()];
}
