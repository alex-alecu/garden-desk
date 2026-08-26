# Desktop Architecture Diagram

Updated: 2026-07-20

```mermaid
flowchart TD
    UI["Tauri webview: React and TypeScript"] --> Host["Minimal Tauri Rust host"]
    Host --> Core["Vault Core local daemon"]
    Host --> Dialogs["Native folder and file dialogs"]
    Dialogs --> Grants["Opaque folder grants and attachments"]
    Grants --> Core

    Core --> Sessions["Folder-grouped sessions and New chat"]
    Core --> Jobs["Jobs, cancellation, and recovery"]
    Core --> Policy["Policy and audit"]
    Core --> Agent["Core-owned agent loop"]

    Agent --> Inference["Constrained host-native inference"]
    Agent --> VM["Session-scoped no-network microVM"]
    VM --> Inputs["Live read-only /source"]
    VM --> Scratch["Persistent bounded /workspace"]
    VM --> Python["Fixed Python and libraries"]
    VM --> Node["Fixed Node.js runtime"]
    VM --> Shell["Fixed /bin/sh and BusyBox"]
    VM --> Agent

    Sessions --> UI
    Jobs --> UI
    Policy --> UI
```

## Notes

- The webview has no unrestricted filesystem, shell, process, environment, endpoint, or network capability.
- Vault Core owns grants, sessions, model mediation, limits, cancellation, audit, and result validation.
- The microVM has zero virtual NICs and cannot write to the selected host folder.
- Post-V1 document intelligence may add deterministic fast paths without changing these boundaries.
