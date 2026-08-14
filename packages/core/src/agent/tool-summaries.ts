import type { ChatToolCall } from "@vault/shared";

const MAX_OBJECT_LENGTH = 80;

/**
 * Middle-truncates a long object (path, pattern, command) so both ends stay readable: a deep
 * `/source/very/long/name` keeps its directory and filename. Short values pass through.
 */
function truncateMiddle(value: string, limit = MAX_OBJECT_LENGTH): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${collapsed.slice(0, head)}…${collapsed.slice(collapsed.length - tail)}`;
}

function stringParam(call: ChatToolCall, key: string): string | undefined {
  if (typeof call.params !== "object" || call.params === null) return undefined;
  const value = (call.params as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface VerbObject {
  running: string;
  done: string;
}

function pathScope(call: ChatToolCall): string {
  const path = stringParam(call, "path");
  return path === undefined ? "" : ` in ${truncateMiddle(path)}`;
}

function verbObject(call: ChatToolCall): VerbObject {
  switch (call.name) {
    case "read": {
      const path = stringParam(call, "path");
      const object = path === undefined ? "a file" : truncateMiddle(path);
      return { running: `Reading ${object}`, done: `Read ${object}` };
    }
    case "glob": {
      const pattern = stringParam(call, "pattern") ?? "files";
      return {
        running: `Finding files matching ${truncateMiddle(pattern)}`,
        done: `Found files matching ${truncateMiddle(pattern)}`,
      };
    }
    case "grep": {
      const pattern = stringParam(call, "pattern") ?? "text";
      const scope = pathScope(call);
      return {
        running: `Searching for ${truncateMiddle(pattern)}${scope}`,
        done: `Searched for ${truncateMiddle(pattern)}${scope}`,
      };
    }
    case "list": {
      const path = stringParam(call, "path");
      const object = path === undefined ? "the workspace" : truncateMiddle(path);
      return { running: `Listing ${object}`, done: `Listed ${object}` };
    }
    case "python":
    case "node":
      return { running: "Running code", done: "Ran code" };
    case "bash": {
      const command = stringParam(call, "command");
      const object = command === undefined ? "a command" : truncateMiddle(command);
      return { running: `Running ${object}`, done: `Ran ${object}` };
    }
    case "skill": {
      const name = stringParam(call, "name") ?? "a skill";
      return { running: `Loading ${name} skill`, done: `Loaded ${name} skill` };
    }
    case "task": {
      const object = subagentTitle(call);
      return { running: object, done: object };
    }
    case "question":
      return { running: "Asking a question", done: "Question answered" };
    default:
      return { running: `Using ${call.name}`, done: `${call.name} completed` };
  }
}

/** The sub-agent lane title is the model-supplied task description, bounded for display. */
export function subagentTitle(call: ChatToolCall): string {
  const description = stringParam(call, "description");
  return description === undefined ? "Sub-agent task" : truncateMiddle(description, 120);
}

export function toolStartedSummary(call: ChatToolCall): string {
  return verbObject(call).running;
}

export function toolCompletedSummary(
  call: ChatToolCall,
  failed: boolean,
  status?: "already_loaded",
): string {
  if (call.name === "skill" && status === "already_loaded") {
    const name = stringParam(call, "name") ?? "This";
    return `${name} skill was already loaded.`;
  }
  const object = verbObject(call);
  return failed ? `${object.running} failed.` : `${object.done}.`;
}
