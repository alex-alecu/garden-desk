# Glossary

Created: 2026-07-10

This glossary defines product language for Vault Desk documentation.

## Vault Desk Community

The free and open-source desktop application for single-user local AI document work.

## Vault Desk Personal Computer

A validated personal desktop, mini-PC, or later laptop that ships with Vault Desk installed, configured, tested, and supported.

## Vault Desk Office

A local network appliance for small professional offices, with shared workspaces, user accounts, policy controls, audit, backup, and central inference.

## Certainty

The value Vault Desk sells: validated hardware, installed software, curated models, predictable performance, secure operation, support, recovery, and business controls.

## Workflow Pack

A set of task flows, prompts, tools, validation checks, exports, and evaluations for a professional domain such as accounting or legal work.

## Knowledge Bundle

A passive, immutable, versioned offline library of domain source evidence, metadata, provenance, rights records, normalized representations, and optional rebuildable retrieval accelerators. A Knowledge Bundle provides evidence but cannot add tools, prompts, workflows, approvals, or execution authority.

## Document Plane

The subsystem that extracts, parses, OCRs, chunks, indexes, retrieves, and cites document evidence.

## Control Plane

The local orchestration subsystem that manages sessions, jobs, tools, policy, approvals, audit, model routing, and diagnostics.

## Inference Plane

The subsystem that hosts or connects to local and optionally remote model runtimes.

## Deterministic Document Tool

A typed, versioned operation over canonical document data, such as search, filter, sort, join, compare, aggregate, calculate, extract, or export. It is preferred over model-generated code for supported operations.

## No-Network MicroVM

A small virtual machine started without any network interface (no NIC), so the guest has no network path at all. Vault Desk runs hostile document processing and agent-authored code only inside one.

## Code Interpreter

A fallback worker that generates and executes short-lived code for unsupported transformations inside a disposable no-network microVM with read-only inputs, pinned offline libraries, resource limits, audit, verification, and no direct export authority.

## Business Control Layer

The paid governance layer for multi-user administration, identity, roles, permissions, approvals, audit, backup, appliance management, and support operations.

## Evidence-Linked Answer

An answer that exposes the documents, pages, chunks, tables, regions, and tool results that support it.

## Approval-Gated Action

An action that requires preview, policy acceptance, and explicit human approval before execution.
