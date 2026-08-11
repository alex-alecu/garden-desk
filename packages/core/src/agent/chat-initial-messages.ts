import type { ChatMessage } from "@vault/shared";
import type { ChatAgentInput } from "./chat-loop.js";

function systemText(input: ChatAgentInput): string {
  const skills = input.skills
    .metadata()
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
  return [
    input.agent.body,
    "Environment: all commands run in a no-network guest. /source is the selected folder and is read-only. /workspace is writable and persistent. Attachments are under /run/attachments.",
    `Available skills (load a body only with the skill tool):\n${skills || "(none)"}`,
  ].join("\n\n");
}

export function initialChatMessages(input: ChatAgentInput): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", text: systemText(input) }];
  if (input.history?.summary) {
    messages.push({
      role: "user",
      text: `<anchored-summary>\n${input.history.summary}\n</anchored-summary>`,
    });
  } else {
    for (const item of input.history?.messages ?? []) {
      messages.push({
        role: item.role,
        text: item.content,
        ...(item.role === "assistant" ? { toolCalls: [] } : {}),
      } as ChatMessage);
    }
  }
  const names = input.inputNames?.length ? `\nSelected inputs: ${input.inputNames.join(", ")}` : "";
  const scripts = input.savedScripts?.length
    ? `\nSaved scripts from earlier steps under /workspace (read one and extend a copy instead of retyping its data): ${input.savedScripts.join(", ")}`
    : "";
  messages.push({ role: "user", text: `${input.task}${names}${scripts}` });
  return messages;
}
