export interface DesktopCapabilities {
  guidedExamples?: Array<{ label: string; prompt: string }> | undefined;
  nativeActions: boolean;
  unavailableReason?: string | undefined;
}

export const productionCapabilities: DesktopCapabilities = {
  nativeActions: true,
};
