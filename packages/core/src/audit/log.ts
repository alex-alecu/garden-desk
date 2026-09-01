import { createHash } from "node:crypto";
import {
  type AuditEvent,
  type AuditEventInput,
  AuditEventInputSchema,
  AuditEventSchema,
} from "@gardendesk/shared";
import type { DatabasePort } from "../workspace/database.js";

type AuditValue = string | number | boolean | null;
interface AuditHead {
  sequence: number;
  hash: string;
}
const SENSITIVE_KEY = /body|content|document|password|prompt|secret|text|token/iu;

function safeMetadata(metadata: Record<string, AuditValue>): Record<string, AuditValue> {
  return Object.fromEntries(
    Object.entries(metadata)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : value]),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function eventHash(event: Omit<AuditEvent, "hash">): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(event)).digest("hex")}`;
}

export class AuditLog {
  constructor(private readonly database: DatabasePort) {}

  private head(): AuditHead | undefined {
    return this.database
      .prepare("SELECT sequence, hash FROM audit_head WHERE singleton = 1")
      .get() as AuditHead | undefined;
  }

  private events(): AuditEvent[] {
    const rows = this.database
      .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
      .all() as Array<{ event_json: string }>;
    return rows.map((row) => AuditEventSchema.parse(JSON.parse(row.event_json)));
  }

  append(input: AuditEventInput): AuditEvent {
    const parsed = AuditEventInputSchema.parse(input);
    return this.database.transaction(() => {
      const existing = this.events();
      if (!this.validChain(existing)) throw new Error("audit_chain_invalid");
      const previous = existing.at(-1);
      const unsigned = {
        schemaVersion: 1 as const,
        sequence: existing.length,
        timestamp: new Date().toISOString(),
        previousHash: previous?.hash ?? null,
        type: parsed.type,
        outcome: parsed.outcome,
        metadata: safeMetadata(parsed.metadata),
      };
      const event = AuditEventSchema.parse({ ...unsigned, hash: eventHash(unsigned) });
      this.database
        .prepare("INSERT INTO audit_events (sequence, event_json) VALUES (?, ?)")
        .run(event.sequence, JSON.stringify(event));
      this.database
        .prepare(
          "INSERT INTO audit_head VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET sequence = excluded.sequence, hash = excluded.hash",
        )
        .run(event.sequence, event.hash);
      return event;
    })();
  }

  private validChain(events: AuditEvent[]): boolean {
    const head = this.head();
    const chainIsValid = events.every((event, index) => {
      const { hash, ...unsigned } = event;
      return (
        unsigned.sequence === index &&
        hash === eventHash(unsigned) &&
        unsigned.previousHash === (events[index - 1]?.hash ?? null)
      );
    });
    const tail = events.at(-1);
    return (
      chainIsValid &&
      (tail === undefined
        ? head === undefined
        : head?.sequence === tail.sequence && head.hash === tail.hash)
    );
  }

  verify(): boolean {
    try {
      return this.validChain(this.events());
    } catch {
      return false;
    }
  }
}
