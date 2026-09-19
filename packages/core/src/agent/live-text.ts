export class LiveRunText {
  private readonly responses = new Map<string, string | null>();
  private readonly thoughts = new Map<string, string | null>();

  setResponse(runId: string, response: string | null): void {
    this.responses.set(runId, response);
  }

  setThinking(runId: string, thinking: string | null): void {
    this.thoughts.set(runId, thinking);
  }

  response(runId: string, stored: string | null): string | null {
    return this.responses.has(runId) ? (this.responses.get(runId) ?? null) : stored;
  }

  thinking(runId: string): string | null {
    return this.thoughts.get(runId) ?? null;
  }

  clear(runId: string): void {
    this.responses.delete(runId);
    this.thoughts.delete(runId);
  }
}
