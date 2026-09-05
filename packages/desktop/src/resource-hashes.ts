export interface ResourceHashes {
  migrations: Record<string, string>;
  windowsPipeGuard?: string;
  windowsSetupHelper?: string;
  windowsSetupHelperSignature?: string;
  inferenceHelper?: string;
  inferenceHelperSignature?: string;
  inferenceRuntime?: Record<string, string>;
  agentHelper?: string;
  agentHelperSignature?: string;
  agentKernel?: string;
  agentInitramfs?: string;
  generationModel?: string;
  projectorModel?: string;
  resourceManifest?: string;
}
