# Phase 0 — Foundation Specification

- **Status:** In progress (scaffold complete; database layer verified via PGlite; Supabase Cloud push and Jana review pending)
- **Owner:** EV
- **Approved by:** Jana (2026-10-31)
- **Architecture:** [ADR-001](../adr/ADR-001-core-architecture.md) (PROPOSED,
  with approvals recorded separately)

## 1. Objective

Create a durable, permissioned foundation that lets EV and NILA write to one
authoritative state, while RIN and ELIO participate through honest human relay.
Phase 0 proves the plumbing; it does not pretend the integrations are finished.

## 2. Scope

### In scope

- pnpm workspace with TypeScript project references.
- `@nexora/contracts`: Zod schemas for identities, events, tasks, decisions,
  permissions and API envelopes.
- `@nexora/sdk-ts`: typed HTTP client with contract validation.
- `@nexora/core`: Fastify API skeleton, health/readiness, identity/event/task/
  decision/permission routes, permission enforcement.
- PostgreSQL/Supabase migrations: schema, append-only event guards, permission
  function, RLS, seed identities.
- Tier A adapter skeletons for EV and NILA.
- Tier C relay adapters for RIN and ELIO.
- Minimal 2D console that reports real Core API health.
- Environment examples with no secrets.
- README, ADR, this spec, CI workflow.

### Out of scope

- Live RIN or ELIO connections.
- 3D house or any 3D rendering.
- Production per-identity authentication and token rotation.
- Realtime delivery, background workers, queues, Redis.
- Billing, notifications, analytics.
- Any change to FINORA.

## 3. Architecture

```
 EV (OpenCode) ──┐
                 │  Tier A: typed HTTP + bearer token
 NILA (Copilot) ─┤
                 ▼
          ┌──────────────┐        ┌────────────────────┐
          │  Core API    │───────▶│ PostgreSQL         │
          │  Fastify     │  SQL   │ (Supabase Cloud)   │
          └──────────────┘        │  aggregates        │
                 ▲                │  append-only events│
                 │                │  permissions + RLS │
      ┌──────────┴─────────┐      └────────────────────┘
      │ Tier C relays      │
      │ Jana carries input │
      │ from RIN / ELIO    │
      └────────────────────┘
```

Rules:

1. Only the Core API writes aggregates and events.
2. Every write is one transaction: permission check → aggregate change → event.
3. Events are immutable; corrections are new events.
4. Browser clients never hold database credentials or the service role key.

## 4. Components

| Path | Package | Responsibility |
| --- | --- | --- |
| `apps/core` | `@nexora/core` | HTTP API, validation, auth hook, permission checks |
| `apps/console` | `@nexora/console` | Minimal 2D status console |
| `packages/contracts` | `@nexora/contracts` | Zod wire contracts and transition rules |
| `packages/sdk-ts` | `@nexora/sdk-ts` | Typed client for the Core API |
| `adapters/ev-opencode` | Tier A | EV event/reporting surface |
| `adapters/nila-copilot` | Tier A | NILA event/reporting surface |
| `adapters/elio-relay` | Tier C | Human-relayed ELIO notes with provenance |
| `adapters/rin-bridge` | Tier C | Human-relayed RIN notes with provenance |
| `infra/supabase` | — | Migrations, seed, deployment notes |

## 5. Data model

| Table | Purpose | Key guarantees |
| --- | --- | --- |
| `nexora.identities` | Humans and AI participants | Unique handle, tier, status, adapter key |
| `nexora.tasks` | Work items | Optimistic `version`, status transition rules in contracts |
| `nexora.decisions` | Decision records linked to ADRs | Approved/rejected rows require decider, time and resolution |
| `nexora.events` | Durable history | Append-only triggers; global `seq`; actor and correlation fields |
| `nexora.permissions` | Explicit grants | Resource/action/optional id, expiry, revocation, unique active grant |

All domain tables live in the `nexora` schema. `public` and `auth` remain owned
by Supabase.

## 6. Event model

Event types for `schema_version = 1`:

```
identity.created, identity.updated
task.created, task.updated, task.assigned, task.status_changed
decision.proposed, decision.decided, decision.superseded
permission.granted, permission.revoked
system.note
```

`system.note` carries relay provenance:

```json
{
  "originIdentity": "rin",
  "channel": "human_relay",
  "message": "…",
  "topic": "architecture"
}
```

The `actorId` is the human who relayed the message, never the origin assistant.
EV must not claim direct communication with RIN, NILA or ELIO.

`identity.*`, `task.updated`, `task.assigned`, `decision.superseded` and
`permission.*` are reserved in the version 1 enum for routes not yet
implemented. Tasks and decisions currently emit create/status/decide events;
identity and permission administration still happens through seed SQL.

## 7. Permission model

A grant is `(identity, resource_type, resource_id?, action)` with optional
expiry and revocation. `resource_id = null` means every resource of that type.

- Owners (`identity.tier = 'owner'`) pass every check by role.
- Everyone else needs an active, unexpired grant.
- The check is `nexora.has_permission(...)`, used by both the API and RLS.
- Gaps: granting and revoking permissions has schema support but no API route
  yet. Phase 0 grants come from `seed.sql`.

## 8. API surface

Base URL: `http://127.0.0.1:4000` in development.

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/health` | Liveness | Public |
| GET | `/health/ready` | Database readiness (503 when degraded) | Public |
| GET | `/v1/identities` | List identities | Bearer |
| GET | `/v1/identities/:id` | Fetch identity | Bearer |
| POST | `/v1/identities` | Create identity | Bearer (admin-level operation) |
| POST | `/v1/events` | Append event after permission check | Bearer |
| GET | `/v1/events` | List events by aggregate/seq | Bearer |
| POST | `/v1/tasks` | Create task + `task.created` event | Bearer |
| GET | `/v1/tasks` | List/filter tasks | Bearer |
| GET | `/v1/tasks/:id` | Fetch task | Bearer |
| POST | `/v1/tasks/:id/status` | Transition status + event | Bearer |
| POST | `/v1/decisions` | Propose decision + event | Bearer |
| GET | `/v1/decisions` | List/filter decisions | Bearer |
| GET | `/v1/decisions/:id` | Fetch decision | Bearer |
| POST | `/v1/decisions/:id/decide` | Approve/reject + event | Bearer + `decision:approve` |
| GET | `/v1/permissions` | List grants | Bearer |

Errors use one envelope:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Identity … lacks 'approve' permission on decision …",
    "requestId": "req-1"
  }
}
```

## 9. Authentication and security debt

Phase 0 uses **one shared bearer token** for the hub. This authenticates the
service, not the individual caller. An identity UUID in a request body is
validated for existence, status and permission, but possession of the shared
token is enough to name any identity.

**This is acceptable only in a trusted local/staging environment.** Before the
API is exposed publicly:

1. Issue per-identity credentials (hashed at rest) or integrate Supabase Auth.
2. Derive the actor from the credential; remove actor IDs from request bodies.
3. Add rate limiting and request size limits per identity.
4. Add audit alerts for owner-tier actions.
5. Rotate the Phase 0 token and retire it.

Additional Phase 0 constraints:

- No rate limiting.
- No realtime delivery; consumers poll.
- Console is read-only status plus documentation.
- No backup, retention or export policy defined.
- No automated database integration tests yet.

## 10. Configuration

See `.env.example` files. Rules:

- `NODE_ENV=production` refuses to start without `DATABASE_URL` and
  `NEXORA_API_TOKEN`.
- `DATABASE_SSL=require` for Supabase Cloud, `disable` for the local stack.
- Secrets are never committed; `.env*` is ignored except examples.
- The console receives only `VITE_NEXORA_API_URL` and, locally,
  `VITE_NEXORA_API_TOKEN`.

## 11. Definition of done

- [x] Workspace, TypeScript references and package boundaries exist.
- [x] Contracts cover identities, events, tasks, decisions, permissions.
- [x] Core API skeleton with liveness and readiness.
- [x] Migrations for PostgreSQL/Supabase with append-only events and RLS.
- [x] Tier A adapter skeletons (EV, NILA) and Tier C relays (RIN, ELIO).
- [x] Environment examples, README, ADR and this spec.
- [x] Migrations executed against PostgreSQL — PGlite 0.5.13 (PostgreSQL 18.6,
  WASM build); no native PostgreSQL server and no Docker on this machine.
- [x] Database-layer smoke test: seed → create task → transition → append-only
  event history, including negative permission and immutability cases.
- [ ] `supabase db push` against Supabase Cloud (requires project ref + credentials).
- [ ] HTTP API end-to-end run against a live PostgreSQL instance.
- [ ] NILA transport decision recorded in an ADR.
- [ ] Per-identity authentication design approved.
- [ ] Jana review of the whole scaffold.

## 12. Verification record

To be completed by EV with real command output after the scaffold is installed
and checked. Nothing in this section may be marked passed without evidence.

| Check | Command | Result |
| --- | --- | --- |
| Install | `corepack pnpm install` | **PASS** — pnpm 12.16.1, 129 packages |
| Typecheck | `corepack pnpm typecheck` | **PASS** — tsc project references + console |
| Unit tests | `corepack pnpm test` | **PASS** — 21 tests (contracts 10, SDK 5, core 6) |
| Build | `corepack pnpm build` | **PASS** — Core/adapters `tsc -b`, console Vite bundle |
| Liveness | `GET /health` | **PASS** — HTTP 200, contract-valid JSON |
| Readiness (no DB) | `GET /health/ready` | **PASS** — HTTP 503, `database.status = not_configured` |
| Error envelope | `GET /v1/missing` | **PASS** — HTTP 404, structured `not_found` |
| Migrations (DB engine) | PGlite 0.5.13 — PostgreSQL 18.6 | **PASS** — `init` + `permissions` applied cleanly; not yet applied to Supabase Cloud |
| Seed | `seed.sql` ×2 | **PASS** — 5 identities, 20 grants; second run is idempotent |
| Permission model | owner / EV / ELIO probes | **PASS** — owner bypass, EV task write, ELIO read-only, revoked grant denied |
| DB smoke test | insert task → transition → event | **PASS** — task starts `v1/backlog`, version increments, event `seq = 1` |
| Append-only events | `UPDATE` / `TRUNCATE` on `nexora.events` | **PASS** — both rejected by trigger |
| Decision integrity | approve without decider | **PASS** — rejected by constraint; valid approval succeeds |
| Actor from JWT | `nexora.current_actor_id()` | **PASS** — resolves the Supabase JWT claim |
| Supabase Cloud push | `supabase db push` | **BLOCKED** — no CLI project link or credentials; requires Jana |
| HTTP API end-to-end | `POST /v1/tasks` against live DB | **BLOCKED** — needs a running PostgreSQL instance |

Verification date: 2026-10-31, Windows, Node 24.22.1.

Environment note: the database checks ran through `@electric-sql/pglite`, a real
PostgreSQL 18.6 build compiled to WebAssembly, driven by a plain ES module
script outside the repository. No Docker, no local PostgreSQL server, and no
Supabase CLI link were available. The SQL is unchanged between that run and a
Supabase deployment, but Supabase-specific behaviour (Auth JWT wiring, pooler,
RLS as a hosted role) still needs the Cloud run.
