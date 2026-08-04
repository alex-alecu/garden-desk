const stageLabels = {
  coreBundle: "Bundling the Vault Core backend",
  coreExecutable: "Creating and signing the Vault Core executable",
  currentUserTransport: "Building the current-user local transport helper",
  windowsPermissionSetup: "Building the one-time Windows permission helper",
  inferenceWorker: "Bundling the local inference worker",
  inferenceRuntime: "Copying the local inference runtime and native backends",
  inferenceIsolation: "Building the Windows inference isolation helper",
  cudaRuntime: "Verifying and copying the Windows CUDA runtime",
  agentHelper: "Building the no-network agent VM helper",
  agentImage: "Copying the no-network agent VM image",
  model: "Verifying the 6.5 GiB local model for packaging",
  manifest: "Hashing and recording the complete offline resource package",
} as const;

export type DevelopmentResourceStage = keyof typeof stageLabels;

export function developmentResourceStageMessage(stage: DevelopmentResourceStage): string {
  return `[Vault Desk startup] ${stageLabels[stage]}...`;
}

export function reportDevelopmentResourceStage(stage: DevelopmentResourceStage): void {
  console.log(developmentResourceStageMessage(stage));
}
