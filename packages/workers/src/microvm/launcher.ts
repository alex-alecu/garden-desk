import type {
  AgentExecutionResult,
  AgentVmDiagnosticCode,
  MicroVmProbeReport,
  WorkerLimits,
} from "@vault/shared";

export interface MicroVmLaunchRequest {
  jobId: string;
  readonlyInputs: string[];
  limits: WorkerLimits;
  signal?: AbortSignal;
}

export type MicroVmLaunchResult = MicroVmProbeReport;

export interface MicroVmLauncher {
  launchProbe(request: MicroVmLaunchRequest): Promise<MicroVmLaunchResult>;
}

export interface AgentInputFile {
  path: string;
  name: string;
}

export interface MicroVmAgentRequest {
  sessionId: string;
  sourceFolder: string;
  readonlyInputs: AgentInputFile[];
  limits: WorkerLimits;
  observer?: AgentExecutionObserver;
  signal?: AbortSignal;
}

export type AgentSessionExecution =
  | { language: "python" | "node"; path: string; source?: string }
  | { language: "shell"; command: string };

export type ResolvedAgentSessionExecution =
  | { language: "python" | "node"; path: string; source: string }
  | { language: "shell"; command: string };

export type AgentExecutionUpdate =
  | { kind: "stream"; stream: "stdout" | "stderr"; bytes: Uint8Array }
  | {
      kind: "diagnostic";
      code: AgentVmDiagnosticCode;
      platform: "guest" | "macos" | "windows";
      platformCode?: string | undefined;
    };

export interface AgentExecutionObserver {
  executionId: string;
  onPrepared?(execution: ResolvedAgentSessionExecution): void | Promise<void>;
  onUpdate(update: AgentExecutionUpdate): void | Promise<void>;
}

export interface CodeAgentSession {
  execute(
    request: AgentSessionExecution,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ): Promise<AgentExecutionResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface CodeAgentLauncher {
  openAgentSession(request: MicroVmAgentRequest): Promise<CodeAgentSession>;
  deleteWorkspace(sessionId: string): Promise<void>;
  readWorkspaceFile?(sessionId: string, path: string): Promise<Buffer | undefined>;
}
