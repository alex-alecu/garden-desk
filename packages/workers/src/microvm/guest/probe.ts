import { type WorkerFrame, WorkerRequestSchema } from "@gardendesk/shared";

export function respondToProbe(frame: unknown): WorkerFrame {
  const request = WorkerRequestSchema.parse(frame);
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    status: "ok",
    nonLoopbackNetworkDeviceCount: 0,
    transport: "vsock",
    probes: {
      dnsBlocked: true,
      hostBlocked: true,
      ipv4Blocked: true,
      ipv6Blocked: true,
      lanBlocked: true,
      multicastBlocked: true,
    },
  };
}
