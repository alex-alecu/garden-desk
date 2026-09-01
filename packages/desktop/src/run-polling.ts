import type { AgentRunSnapshot } from "@gardendesk/shared";

const POLL_INTERVAL_MS = 350;
const RETRY_INTERVAL_MS = 250;
const LOCAL_REQUEST_ATTEMPTS = 3;

type Pause = (milliseconds: number) => Promise<void>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((accept) => setTimeout(accept, milliseconds));
}

export async function retryLocalRequest<T>(
  request: () => Promise<T>,
  pause: Pause = delay,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < LOCAL_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < LOCAL_REQUEST_ATTEMPTS) await pause(RETRY_INTERVAL_MS);
    }
  }
  throw lastError;
}

interface WaitForAgentRunOptions {
  runId: string;
  read(runId: string): Promise<AgentRunSnapshot>;
  onSnapshot(snapshot: AgentRunSnapshot): void;
  pause?: Pause;
}

export async function waitForAgentRun(options: WaitForAgentRunOptions): Promise<AgentRunSnapshot> {
  const pause = options.pause ?? delay;
  while (true) {
    const snapshot = await retryLocalRequest(() => options.read(options.runId), pause);
    options.onSnapshot(snapshot);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await pause(POLL_INTERVAL_MS);
  }
}
