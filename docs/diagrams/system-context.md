# System Context Diagram

Created: 2026-07-10

```mermaid
flowchart LR
    User["Professional user"] --> Desktop["Vault Desk Desktop: Tauri"]
    Admin["Office administrator"] --> OfficeAdmin["Vault Desk Office Admin"]

    Desktop --> Control["Local Control Plane"]
    OfficeAdmin --> Control

    Control --> Documents["User-selected read-only folders and attachments"]
    Control --> Inference["Local inference runtimes"]
    Control --> Sandbox["Session-scoped no-network dev-agent microVM"]
    Control --> NetworkBroker["Typed external-connection broker"]
    Control --> Audit["Local audit log"]
    Control --> Backup["Backup and recovery"]

    Control -. "explicitly enabled only" .-> RemoteSupport["Remote support"]
    Control -. "explicitly enabled only" .-> HostedEscalation["Hosted model escalation"]
```

## Notes

- Hosted escalation is not a default dependency.
- Remote support is not a default access path.
- The selected folder remains local, live, and read-only to the guest; the bounded session workspace is private Vault Desk state.
- Agent-authored code has no virtual network device; approved future external connections use the separate broker.
