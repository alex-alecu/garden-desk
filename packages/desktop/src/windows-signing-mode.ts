export type WindowsSigningConfiguration =
  | { mode: "development" }
  | { mode: "production"; certificateThumbprint: string; timestampUrl?: string };

export function windowsSigningConfiguration(
  environment: NodeJS.ProcessEnv,
): WindowsSigningConfiguration {
  const configuredThumbprint = environment.GARDEN_DESK_WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT;
  const mode =
    environment.GARDEN_DESK_WINDOWS_SIGNING_MODE ??
    (configuredThumbprint === undefined ? "development" : "production");
  if (mode === "development") return { mode };
  if (mode !== "production") {
    throw new Error("GARDEN_DESK_WINDOWS_SIGNING_MODE must be development or production.");
  }
  const certificateThumbprint = configuredThumbprint?.replaceAll(" ", "").toUpperCase();
  if (certificateThumbprint === undefined || !/^[A-F0-9]{40}$/u.test(certificateThumbprint)) {
    throw new Error("Production Windows signing requires a 40-character certificate thumbprint.");
  }
  const timestampUrl = environment.GARDEN_DESK_WINDOWS_SIGNING_TIMESTAMP_URL;
  return {
    mode,
    certificateThumbprint,
    ...(timestampUrl === undefined ? {} : { timestampUrl }),
  };
}
