export function joinedPromptSections(sections: readonly string[]): string {
  return sections.filter((section) => section.length > 0).join("\n\n");
}

interface PromptSections {
  afterTask: string[];
  beforeTask: string[];
  observationCharacters: number;
  taskState(characters: number): string;
}

function currentPrompt(options: PromptSections): string {
  return joinedPromptSections([
    ...options.beforeTask,
    options.taskState(options.observationCharacters),
    ...options.afterTask,
  ]);
}

export function fitCurrentPrompt(options: PromptSections, maximumCharacters: number): string {
  const current = currentPrompt(options);
  if (current.length <= maximumCharacters) return current;
  const reduced = Math.max(0, options.observationCharacters - (current.length - maximumCharacters));
  return currentPrompt({ ...options, observationCharacters: reduced });
}
