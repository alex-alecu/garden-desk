export function writeResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  process.stdout.write("Garden Desk daemon is healthy.\n");
}

export function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}
