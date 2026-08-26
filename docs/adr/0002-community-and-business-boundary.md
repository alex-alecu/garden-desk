# ADR 0002: Community And Business Boundary

Created: 2026-07-10

Status: Proposed

## Context

Vault Desk should build trust and distribution through a free open-source community product while generating revenue from support, hardware, governance, and business deployments.

The community product must be useful enough to earn trust. The business product must add operational value rather than merely unlock basic function.

## Decision

Vault Desk will separate the useful community application from a business control layer.

Community candidate modules include local desktop workflows, single-user document ingestion, local retrieval, safe folder access, basic approvals, exports, and hardware compatibility checks.

Business candidate modules include organization management, identity, roles, permission-aware retrieval, shared workspaces, immutable audit, backup orchestration, appliance administration, fleet management, long-term support channels, integrations, and support tooling.

## Consequences

Positive:

- Trust and adoption from a real open-source product.
- Clear reason for businesses to pay.
- Compatible with customer ownership.

Negative:

- Boundary must be designed carefully.
- Business features must not make the community product feel artificially crippled.
- Licensing and contribution policy need legal review.
