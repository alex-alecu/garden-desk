# ADR 0003: Desktop And Appliance Architecture

Created: 2026-07-10

Status: Proposed

## Context

Garden Desk needs to support both a single-user desktop application and a small-office appliance without becoming two unrelated products.

The office appliance adds users, permissions, shared workspaces, audit, backup, and central inference. The desktop product still needs the same core document, model, and tool concepts.

## Decision

Use a shared architecture based on desktop shell, local control plane, inference plane, and document plane.

Desktop mode runs the control plane locally for one user. Office mode runs a larger control plane on the appliance with multi-user governance.

## Consequences

Positive:

- Shared core concepts across product lines.
- Easier progression from community to business edition.
- Future code can keep governance modular.

Negative:

- The control plane must be designed for both single-user simplicity and multi-user extension.
- Early choices may constrain appliance scalability if not validated.
