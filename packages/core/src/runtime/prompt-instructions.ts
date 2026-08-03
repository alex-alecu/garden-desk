import { join, resolve } from "node:path";
import { readPromptFile } from "../prompt-files.js";

let promptDirectory = resolve(process.cwd(), "prompts");
let functionCallInstruction: string | undefined;

export function configurePromptDirectory(directory: string): void {
  promptDirectory = resolve(directory);
  functionCallInstruction = undefined;
}

export function gemmaFunctionCallSuffix(): string {
  functionCallInstruction ??= readPromptFile(
    join(promptDirectory, "system", "function-call.md"),
  ).trim();
  if (functionCallInstruction.length === 0) throw new Error("Function-call prompt is empty.");
  return `\n${functionCallInstruction}`;
}
