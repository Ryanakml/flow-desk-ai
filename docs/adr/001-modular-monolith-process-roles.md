# ADR-001: Modular monolith with independently deployable process roles

- Status: Accepted
- Date: 2026-08-26
- Owners: FlowDesk engineering
- Requirement: M0 execution foundation

## Context

FlowDesk needs clear failure and scaling boundaries for public APIs, Meta webhook ingress, asynchronous jobs, scheduled reconciliation, and the web application without paying the coordination cost of microservices before domain and load evidence exist.

## Decision

Use one TypeScript monorepo and one modular domain codebase deployed as `web`, `api`, `ingress`, `worker`, and `scheduler`. Applications communicate through versioned contracts and durable infrastructure, never imports from another application's internals. A service is split only after profiling, ownership, security, or availability evidence justifies it.

## Consequences

Shared policies stay consistent and local development remains tractable. Each process still needs its own image, health, configuration, resource policy, telemetry, and graceful shutdown. Shared-database shortcuts across module boundaries remain prohibited.

## Reversal

Extract a module behind its existing port/contract. Preserve event idempotency and compatibility during dual operation.
