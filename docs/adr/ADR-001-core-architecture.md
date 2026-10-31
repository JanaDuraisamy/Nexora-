# ADR-001: Core Architecture for NEXORA Phase 0

- **Status:** PROPOSED (preserved — not rewritten after approval)
- **Date:** 2026-10-31
- **Author:** EV
- **Decision owner:** Jana
- **Supersedes:** none
- **Related:** [`docs/specs/phase-0-foundation.md`](../specs/phase-0-foundation.md)

> **Status note.** This document preserves EV's proposal and its PROPOSED
> status. Jana's approved decisions are recorded separately in the
> [Approval record](#approval-record-jana) and take precedence wherever they
> narrow or differ from the proposal text.
>
> **Document provenance.** No prior proposal file existed in the workspace when
> Phase 0 began. The proposal below reconstructs EV's architecture from Jana's
> Phase 0 brief, in which Jana confirmed the options recommended by RIN. If the
> original proposal differs, the original should replace the proposal section
> without changing its PROPOSED status.

## Context

NEXORA is a family of five identities with separate contexts and tools:

| Identity | Role | Context boundary |
| --- | --- | --- |
| JANA | Founder, architect, final decision authority | Human |
| RIN | Requirements, planning, emotional support | Separate assistant; reached through Jana |
| NILA | VS Code / Copilot implementation | Separate assistant; editor-bound |
| ELIO | Architecture, strategy, risk | Separate assistant; reached through Jana |
| EV | OpenCode engineering automation | This workspace |

The current working model has four structural problems:

1. **No shared durable state.** Each assistant works from its own context. Work
   that is not written down is lost or re-litigated.
2. **No provenance.** There is no reliable record of who decided what, when, or
   on whose input.
3. **No explicit authority.** Access is implicit in who happens to hold a tool,
   not in an auditable grant.
4. **Ad-hoc integration.** Every new connection would invent its own transport,
   format and failure behaviour.

Phase 0 needs a foundation that makes coordination durable before adding more
surface area.

## Proposal

### P1 — Hub-and-spoke, central state authority

A single **Core API** owns reads and writes to shared state. Identities are
spokes; they never write to each other's stores directly. The hub validates
contracts, enforces permissions, appends events and updates aggregates in one
transaction.

Rejected shape: peer-to-peer mesh where each assistant owns a fragment of
truth. It produces split-brain state and unresolvable conflicts at this scale.

### P2 — Supabase Cloud with PostgreSQL as the durable source of truth

Supabase provides managed PostgreSQL, auth primitives and future realtime
delivery. PostgreSQL is authoritative; no in-memory or cache-first store is a
source of truth.

**No Redis in Phase 0.** A cache or queue is added only after a demonstrated
requirement (measured latency, fan-out or rate limiting), not by default.

### P3 — Durable, append-only event history

Every meaningful state change appends an event with:

- monotonic `seq` assigned by PostgreSQL,
- event `type` and `schema_version`,
- `aggregate_type` / `aggregate_id`,
- `actor_id` (who caused it, including relay provenance),
- `payload`, `correlation_id`, `causation_id`,
- `occurred_at` and server-assigned `recorded_at`.

Events are immutable. Corrections are new events. Aggregates (`tasks`,
`decisions`) are the current projection and carry an optimistic `version`.

### P4 — Explicit permissions

Access is granted per identity, resource type, optional resource id, and action
(`read`, `write`, `approve`, `admin`). Grants have an optional expiry and a
revocation path. Owners (Jana) hold authority by role; everyone else needs a
grant. The same rule is evaluated in PostgreSQL so API and direct database
clients cannot drift.

### P5 — Contracts-first, type-safe boundary

Zod schemas in `@nexora/contracts` define every wire format. The Core API
validates inbound and outbound payloads; `@nexora/sdk-ts` parses responses; both
fail closed on contract violation. Database column names never leak to clients.

### P6 — Adapter tiers

- **Tier A (direct):** native tool integration with the Core API. EV and NILA
  are the Phase 0 consumers.
- **Tier B (process bridge):** reserved for a future editor/process bridge. No
  Phase 0 consumer.
- **Tier C (human relay):** a human carries messages to and from an assistant
  that has no direct channel. RIN and ELIO start here.

Tier C is recorded honestly: the event actor is the relaying human and the
origin identity is explicit in the payload.

### P7 — Phase 0 scope

In scope: EV and NILA integration surfaces; identity, event, task and decision
contracts; Core API skeleton with health endpoints; PostgreSQL migrations;
permission model; documentation.

Out of scope: live RIN or ELIO connections; 3D house; production-grade
per-identity authentication; realtime UI; background workers.

### P8 — 2D-first workspace

The console is a 2D operational view first. A 3D house is a later, optional
presentation layer over the same state. State must never depend on the 3D
client.

### P9 — Monorepo

`apps/` for runnable surfaces, `packages/` for shared code, `adapters/` for
identity-specific integration boundaries, `infra/` for database and deployment,
`docs/` for ADRs and specs. pnpm workspaces and TypeScript project references
keep the dependency graph explicit.

### P10 — Security baseline

- Secrets live only in environment variables, never in Git.
- The browser never receives the database URL or Supabase service role key.
- Service-role access is confined to the Core API server.
- RLS is enabled with deny-by-default policies for direct authenticated clients.

## Approval record (Jana)

Recorded separately from the proposal, per Jana's instruction. Approved on
2026-10-31 after RIN's recommendation.

| # | Decision | Status | Approved by |
| --- | --- | --- | --- |
| A1 | Hosting: Supabase Cloud | APPROVED | Jana |
| A2 | RIN and ELIO: Tier C human-relay adapters initially | APPROVED | Jana |
| A3 | Phase 0 integrations: EV and NILA only | APPROVED | Jana |
| A4 | Architecture: hub-and-spoke with a central state authority | APPROVED | Jana |
| A5 | Product: 2D-first workspace; optional 3D house in a later phase | APPROVED | Jana |
| A6 | Durable event history and explicit permissions are mandatory | APPROVED | Jana |

These approvals do not silently convert this ADR to ACCEPTED. A status change is
a separate editorial action by Jana, and any implementation deviation must be
recorded as a new decision rather than edited into history.

## Consequences

### Positive

- One authoritative state; conflicts become explicit version checks.
- Auditable provenance, including honest relay attribution.
- Permissions can be reviewed and revoked without changing application code.
- Adapter work is isolated; a new identity cannot reshape the core.
- Contracts make breakage visible at build time and at the API boundary.

### Negative / risks

- The hub is a single point of failure until a deployment topology is decided.
- Every write pays for event + aggregate in one transaction; throughput is
  bounded by PostgreSQL, which is acceptable at family scale.
- A shared Phase 0 service token authenticates the hub, not the identity. A
  compromised token can impersonate any identity. This must be replaced before
  exposing the API beyond a trusted environment.
- Event payload schemas will drift unless `schema_version` is used deliberately.
- Tier C adapters depend on human discipline for accurate provenance.

### Mitigations

- Health and readiness endpoints; database readiness fails closed.
- Optimistic concurrency on aggregates; append-only history for recovery.
- RLS as a second line of defence for direct clients.
- Open security work is tracked explicitly in the Phase 0 spec and this ADR.

## Alternatives considered

| Alternative | Why not now |
| --- | --- |
| Peer-to-peer assistant mesh | Split-brain state, no central audit, conflict resolution undefined |
| Firebase / Firestore | Weaker relational guarantees for event history and permission joins |
| Redis Streams as primary bus | Adds an operational dependency before a demonstrated need; PostgreSQL is already durable |
| Shared Git repository as state | Good for documents, poor for concurrent state, permissions and queries |
| 3D house first | Presentation risk; state and permissions must exist first |
| One custom protocol per identity | Multiplies maintenance and hides provenance inconsistencies |

## What this ADR does not decide

- Production authentication and token rotation.
- The NILA editor-to-hub transport.
- Realtime transport (Supabase Realtime, SSE or polling).
- Event retention, export and archival policy.
- 3D house technology or phase entry criteria.
- Deployment topology, backups and disaster recovery targets.

These require their own decisions before the related work starts.

## Open questions

1. **Identity authentication.** When does the shared token become per-identity
   credentials, and what issues them?
2. **NILA transport.** VS Code extension, local CLI, or MCP server?
3. **Relay UX.** How does Jana record RIN/ELIO input without slowing the
   conversation, while keeping provenance accurate?
4. **Realtime.** Do consumers poll, subscribe through Supabase Realtime, or use
   server-sent events?
5. **Tier B.** What integration pattern justifies introducing it?
6. **3D entry criteria.** Which user outcome requires 3D rather than 2D?

## Decision requested

Adopt P1–P10 as the NEXORA Phase 0 foundation, subject to the approvals in the
record above. The ADR remains **PROPOSED** until Jana changes its status.
