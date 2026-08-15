import type { ChatAgentInput } from "./chat-loop-input.js";
import { GenericToolRegistry } from "./generic-tools.js";

export function createToolRegistry(input: ChatAgentInput): GenericToolRegistry {
  return new GenericToolRegistry({
    executor: input.executor,
    skills: input.skills,
    ...(input.inspectImage === undefined ? {} : { inspectImage: input.inspectImage }),
    ...(input.spawnTask === undefined ? {} : { spawnTask: input.spawnTask }),
    ...(input.askQuestion === undefined ? {} : { askQuestion: input.askQuestion }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}
