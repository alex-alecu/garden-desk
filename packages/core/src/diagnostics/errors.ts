export type DebugSessionErrorCode =
  | "debug_arguments_invalid"
  | "debug_database_unsafe"
  | "debug_schema_unsupported"
  | "debug_session_not_found"
  | "debug_state_invalid"
  | "debug_content_hash_mismatch"
  | "debug_workspace_changed";

export class DebugSessionError extends Error {
  constructor(readonly code: DebugSessionErrorCode) {
    super(code);
    this.name = "DebugSessionError";
  }
}

export function debugStateInvalid(): never {
  throw new DebugSessionError("debug_state_invalid");
}
