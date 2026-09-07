import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Duplex } from "node:stream";

export interface NativeWorkerLaunchRequest {
  workerEntryPath: string;
  modelPath?: string;
  memoryBudgetBytes: number;
  serverArguments?: string[];
  readPaths?: string[];
}

export interface NativeWorkerHandle {
  process: ChildProcessWithoutNullStreams;
  connect?(): Duplex;
  dispose(): Promise<void>;
}

export interface NativeWorkerLauncher {
  readonly gpu?:
    | {
        backend: "cuda" | "vulkan" | "metal";
        memoryKind?: "dedicated" | "unified";
        detectedMemoryBytes?: number;
      }
    | undefined;
  launch(request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle>;
}

export class NativeWorkerLaunchError extends Error {
  constructor(
    readonly code: "unsupported",
    message: string,
  ) {
    super(message);
  }
}
