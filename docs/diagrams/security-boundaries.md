# Security Boundaries Diagram

Updated: 2026-07-20

```mermaid
sequenceDiagram
    participant UI as Tauri webview
    participant Core as Vault Core
    participant Model as Native inference worker
    participant VM as No-NIC agent microVM
    participant Audit as Local audit

    UI->>Core: Session request with opaque folder or attachment IDs
    Core->>Core: Validate and canonicalize grant; load durable history
    Core->>VM: Live read-only source; hydrate bounded workspace
    VM-->>Core: Observable activity or bounded completion request
    Core->>Model: Schema and token-bounded completion
    Model-->>Core: Typed completion
    Core-->>VM: Typed completion result
    VM-->>Core: Source or command, logs, workspace delta, result
    Core->>Core: Validate schema, path, hash, size, and terminal state
    Core->>Audit: Record observable activity and outcome
    Core-->>UI: Streamed result, activity, artifacts, or failure
    Core->>VM: Keep warm or commit and evict
```

## Notes

- The model proposes and Vault Core mediates; neither receives direct host execution authority.
- The guest has zero virtual NICs, no credentials, no package installation, no generic host service, and no writable selected-folder mount. Its durable workspace is private Core state.
- The webview never supplies arbitrary executable names, endpoints, or filesystem paths.
- Generated artifacts remain session-owned proposals and cannot silently mutate the host.
