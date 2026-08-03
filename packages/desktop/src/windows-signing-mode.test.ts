import { describe, expect, it } from "vitest";
import { windowsSigningConfiguration } from "./windows-signing-mode.js";

describe("Windows signing mode", () => {
  it("uses the disposable development identity by default", () => {
    expect(windowsSigningConfiguration({})).toEqual({ mode: "development" });
  });

  it("requires and normalizes the production certificate thumbprint", () => {
    expect(
      windowsSigningConfiguration({
        VAULT_WINDOWS_SIGNING_MODE: "production",
        VAULT_WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT:
          "aa11 aa11 aa11 aa11 aa11 aa11 aa11 aa11 aa11 aa11",
        VAULT_WINDOWS_SIGNING_TIMESTAMP_URL: "https://timestamp.example.test",
      }),
    ).toEqual({
      mode: "production",
      certificateThumbprint: "AA11AA11AA11AA11AA11AA11AA11AA11AA11AA11",
      timestampUrl: "https://timestamp.example.test",
    });
    expect(() => windowsSigningConfiguration({ VAULT_WINDOWS_SIGNING_MODE: "production" })).toThrow(
      "certificate thumbprint",
    );
  });
});
