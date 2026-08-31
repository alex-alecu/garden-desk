import { type InvokeArgs, invoke } from "@tauri-apps/api/core";

export async function withDevelopmentError<T>(
  command: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (import.meta.env.DEV) console.error(`[desktop:${command}]`, error);
    throw error;
  }
}

export function invokeDesktop<T>(
  command: string,
  parse: (value: unknown) => T,
  args?: InvokeArgs,
): Promise<T> {
  return withDevelopmentError(command, async () => parse(await invoke<unknown>(command, args)));
}
