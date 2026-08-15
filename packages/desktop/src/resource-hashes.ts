export interface ResourceHashes {
  migrations: Record<string, string>;
  windowsPipeGuard?: string;
  windowsSetupHelper?: string;
  windowsSetupHelperSignature?: string;
  inferenceHelper?: string;
  inferenceHelperSignature?: string;
  inferenceRuntime?: string;
  inferenceRuntimeSignature?: string;
  inferenceHardwareWorker?: string;
  inferenceWorker?: string;
  cudaAssets?: Record<string, string>;
  agentHelper?: string;
  agentHelperSignature?: string;
  agentKernel?: string;
  agentInitramfs?: string;
  generationModel?: string;
  projectorModel?: string;
  visionRuntime?: Record<string, string>;
  resourceManifest?: string;
}
