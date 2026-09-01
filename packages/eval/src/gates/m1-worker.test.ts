import { decodeFrame, encodeFrame, FrameDecoder } from "@gardendesk/workers";
import { describe, expect, it } from "vitest";

const probeResult = {
  protocolVersion: 1 as const,
  requestId: "m1-probe",
  status: "ok" as const,
  nonLoopbackNetworkDeviceCount: 0,
  transport: "vsock" as const,
  probes: {
    dnsBlocked: true as const,
    hostBlocked: true as const,
    ipv4Blocked: true as const,
    ipv6Blocked: true as const,
    lanBlocked: true as const,
    multicastBlocked: true as const,
  },
};

describe("M1 worker protocol", () => {
  it("round-trips only schema-valid bounded frames", () => {
    const encoded = encodeFrame(probeResult);
    expect(decodeFrame(encoded)).toEqual(probeResult);
    const decoder = new FrameDecoder();
    expect(decoder.push(encoded.subarray(0, 3))).toEqual([]);
    expect(decoder.push(encoded.subarray(3))).toEqual([probeResult]);
  });

  it("rejects an arbitrary forwarding request", () => {
    const payload = Buffer.from(
      JSON.stringify({ operation: "proxy", destination: "https://example.com" }),
    );
    const encoded = Buffer.alloc(4 + payload.length);
    encoded.writeUInt32BE(payload.length);
    payload.copy(encoded, 4);
    expect(() => decodeFrame(encoded)).toThrow();
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(1024 * 1024 + 1);
    expect(() => decodeFrame(oversized)).toThrow("Invalid worker frame length");
  });
});
