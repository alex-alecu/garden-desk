import {
  AgentArtifactSummarySchema,
  AgentEventSchema,
  AgentExecutionSnapshotSchema,
  AgentRunSnapshotSchema,
  ConversationMessageSchema,
  FolderSummarySchema,
  SessionSummarySchema,
} from "@vault/shared";
import { prompts, responses } from "./demo-content.js";

const createdAt = "2026-07-21T09:00:00.000Z";
const completedAt = "2026-07-21T09:00:03.000Z";

export const folder = FolderSummarySchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  name: "Synthetic examples",
  createdAt,
  revokedAt: null,
});

export const sessions = SessionSummarySchema.array().parse([
  {
    id: "20000000-0000-4000-8000-000000000001",
    folderId: folder.id,
    title: "Review unusual transactions",
    createdAt,
    updatedAt: completedAt,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    folderId: folder.id,
    title: "Extract agreement dates",
    createdAt,
    updatedAt: completedAt,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    folderId: folder.id,
    title: "Summarize patient administration",
    createdAt,
    updatedAt: completedAt,
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    folderId: folder.id,
    title: "Standardize CV details",
    createdAt,
    updatedAt: completedAt,
  },
]);
export const financeSession =
  sessions[0] ??
  (() => {
    throw new Error("Synthetic financial session is missing.");
  })();
const agreementSession = sessions[1];
const healthSession = sessions[2];
const cvSession = sessions[3];
if (
  financeSession === undefined ||
  agreementSession === undefined ||
  healthSession === undefined ||
  cvSession === undefined
) {
  throw new Error("Synthetic demo sessions are incomplete.");
}

const initialRunId = "30000000-0000-4000-8000-000000000001";
const initialJobId = "40000000-0000-4000-8000-000000000001";
const initialSessionId = financeSession.id;

export const initialMessages = ConversationMessageSchema.array().parse([
  {
    id: "50000000-0000-4000-8000-000000000001",
    sessionId: initialSessionId,
    role: "user",
    content: prompts.finance,
    runId: initialRunId,
    createdAt,
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    sessionId: initialSessionId,
    role: "assistant",
    content: responses[prompts.finance],
    runId: initialRunId,
    createdAt: completedAt,
  },
]);

const initialArtifact = AgentArtifactSummarySchema.parse({
  id: "60000000-0000-4000-8000-000000000001",
  runId: initialRunId,
  name: "transaction-review.md",
  mediaType: "text/markdown",
  byteLength: 814,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: completedAt,
});

const initialEvents = AgentEventSchema.array().parse([
  {
    id: "70000000-0000-4000-8000-000000000001",
    runId: initialRunId,
    sequence: 0,
    type: "run.started",
    summary: "Offline limits: synthetic browser-only demonstration.",
    createdAt,
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    runId: initialRunId,
    sequence: 1,
    type: "execution.completed",
    summary: "Reviewed 24 synthetic transaction rows.",
    language: "python",
    path: "steps/0001.py",
    source: "Review the in-memory synthetic transaction fixture.",
    exitCode: 0,
    stdout: "24 rows checked; 3 marked for review.\n",
    durationMs: 420,
    termination: "completed",
    createdAt: completedAt,
  },
  {
    id: "70000000-0000-4000-8000-000000000003",
    runId: initialRunId,
    sequence: 2,
    type: "assistant.completed",
    summary: "Response completed.",
    createdAt: completedAt,
  },
]);

const initialExecution = AgentExecutionSnapshotSchema.parse({
  id: "80000000-0000-4000-8000-000000000001",
  runId: initialRunId,
  sequence: 0,
  language: "python",
  path: "steps/0001.py",
  source: "Review the in-memory synthetic transaction fixture.",
  command: null,
  state: "completed",
  exitCode: 0,
  durationMs: 420,
  termination: "completed",
  stdout: "24 rows checked; 3 marked for review.\n",
  stderr: "",
  vmDiagnostics: [],
  stdoutBytes: 42,
  stderrBytes: 0,
  vmDiagnosticsBytes: 0,
  stdoutTruncated: false,
  stderrTruncated: false,
  vmDiagnosticsTruncated: false,
  createdAt,
  updatedAt: completedAt,
  completedAt,
});

export const initialRun = AgentRunSnapshotSchema.parse({
  run: {
    id: initialRunId,
    sessionId: initialSessionId,
    jobId: initialJobId,
    state: "succeeded",
    response: responses[prompts.finance],
    error: null,
    performance: {
      promptTokens: 384,
      outputTokens: 182,
      promptTokensPerSecond: 118.6,
      tokensPerSecond: 31.4,
      totalDurationMs: 6_820,
    },
    createdAt,
    updatedAt: completedAt,
  },
  events: initialEvents,
  executions: [initialExecution],
  artifacts: [initialArtifact],
  thinking: null,
});

export const sampleMessages = new Map([
  [financeSession.id, initialMessages],
  [
    agreementSession.id,
    ConversationMessageSchema.array().parse([
      {
        id: "50000000-0000-4000-8000-000000000003",
        sessionId: agreementSession.id,
        role: "user",
        content: prompts.agreement,
        runId: null,
        createdAt,
      },
      {
        id: "50000000-0000-4000-8000-000000000004",
        sessionId: agreementSession.id,
        role: "assistant",
        content: responses[prompts.agreement],
        runId: null,
        createdAt: completedAt,
      },
    ]),
  ],
  [
    healthSession.id,
    ConversationMessageSchema.array().parse([
      {
        id: "50000000-0000-4000-8000-000000000005",
        sessionId: healthSession.id,
        role: "user",
        content: prompts.health,
        runId: null,
        createdAt,
      },
      {
        id: "50000000-0000-4000-8000-000000000006",
        sessionId: healthSession.id,
        role: "assistant",
        content: responses[prompts.health],
        runId: null,
        createdAt: completedAt,
      },
    ]),
  ],
  [
    cvSession.id,
    ConversationMessageSchema.array().parse([
      {
        id: "50000000-0000-4000-8000-000000000007",
        sessionId: cvSession.id,
        role: "user",
        content: prompts.cv,
        runId: null,
        createdAt,
      },
      {
        id: "50000000-0000-4000-8000-000000000008",
        sessionId: cvSession.id,
        role: "assistant",
        content: responses[prompts.cv],
        runId: null,
        createdAt: completedAt,
      },
    ]),
  ],
]);
