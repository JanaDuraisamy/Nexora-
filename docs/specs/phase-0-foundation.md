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
- Tier A adapter skeleton for EV; Tier B pull-only HTTP adapter for NILA.
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
 NILA (Copilot) ─┤  Tier B: pull-only typed HTTP
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
| `adapters/nila-copilot` | Tier B | NILA pull-only task and event surface |
| `adapters/elio-relay` | Tier C | Human-relayed ELIO notes with provenance |
| `adapters/rin-bridge` | Tier C | Human-relayed RIN notes with provenance |
| `infra/supabase` | — | Migrations, seed, deployment notes |

## 5. Data model

| Table | Purpose | Key guarantees |
| --- | --- | --- |
| `nexora.identities` | Humans and AI participants | Unique handle, tier, status, adapter key, optional `auth_user_id` mapping |
| `nexora.identity_credentials` | Per-identity API keys | SHA-256 digest only, unique, revocable, optional expiry, service-role only |
| `nexora.tasks` | Work items | Optimistic `version`, status transition rules in contracts |
| `nexora.decisions` | Decision records linked to ADRs | Approved/rejected rows require decider, time and resolution |
| `nexora.events` | Durable history | Append-only triggers; global `seq`; actor and correlation fields |
| `nexora.permissions` | Explicit grants | Resource/action/optional id, expiry, revocation; two partial unique indexes |
| `nexora.idempotency_keys` | Retry protection | `(identity, scope, key)` primary key, written with the resource it protects |

All domain tables live in the `nexora` schema. `public` and `auth` remain owned
by Supabase.

Active-grant uniqueness uses two partial indexes — one for global grants
(`resource_id is null`) and one for scoped grants — instead of reserving a
sentinel UUID, so any valid UUID can be used as a resource id.

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

The `actorId` is the human bound to the credential, never the origin assistant.
`originIdentity` is an explicit assertion recorded in the payload; it is not
identity proof. EV must not claim direct communication with RIN, NILA or ELIO.

**Domain events are Core-only.** `POST /v1/events` accepts notes only
(`system.note`, `aggregate_type = system`, `aggregate_id = null`). Task,
decision, identity and permission events are written by the route handlers that
own those invariants, in the same transaction as the state change.

## 7. Permission model

A grant is `(identity, resource_type, resource_id?, action)` with optional
expiry and revocation. `resource_id = null` means every resource of that type.

- Owners (`identity.tier = 'owner'`) pass every check by role.
- Everyone else needs an active, unexpired grant.
- The check is `nexora.has_permission(...)`, used by both the API and RLS.
- Grants are administered through `POST /v1/permissions` and
  `POST /v1/permissions/:id/revoke`, both requiring `permission:admin`.
- Phase 0 reference grants still come from `seed.sql`.

## 8. API surface

Base URL: `http://127.0.0.1:4000` in development.

Every `/v1` route requires a per-identity bearer credential. The acting identity
is derived server-side; no request body field can name a different actor. The
`Auth` column lists the permission the actor must additionally hold.

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | `/health` | Liveness | Public |
| GET | `/health/ready` | Database readiness (503 when degraded) | Public |
| GET | `/v1/whoami` | Identity bound to the credential | Bearer |
| GET | `/v1/identities` | List identities | Bearer |
| GET | `/v1/identities/:id` | Fetch identity | Bearer |
| POST | `/v1/identities` | Create identity + `identity.created` | Bearer + `identity:admin` |
| POST | `/v1/events` | Append a non-domain note | Bearer + `event:write` |
| GET | `/v1/events` | Read events, cursor via `afterSeq` | Bearer + `event:read` |
| POST | `/v1/tasks` | Create task + `task.created`; optional `Idempotency-Key` | Bearer + `task:write` |
| GET | `/v1/tasks` | List/filter tasks | Bearer + `task:read` |
| GET | `/v1/tasks/:id` | Fetch task | Bearer + `task:read` |
| POST | `/v1/tasks/:id/status` | Transition status + event | Bearer + `task:write` |
| POST | `/v1/tasks/:id/assign` | Assign/release + `task.assigned` | Bearer + `task:write` |
| POST | `/v1/tasks/:id/claim` | Atomic claim + `task.assigned` | Bearer + `task:write` |
| POST | `/v1/decisions` | Propose decision + event | Bearer + `decision:write` |
| GET | `/v1/decisions` | List/filter decisions | Bearer + `decision:read` |
| GET | `/v1/decisions/:id` | Fetch decision | Proposer or `decision:read` |
| POST | `/v1/decisions/:id/decide` | Approve/reject + event | Bearer + `decision:approve` |
| GET | `/v1/permissions` | List own grants, or any with admin | Bearer (+ `permission:admin` for others) |
| POST | `/v1/permissions` | Grant + `permission.granted` | Bearer + `permission:admin` |
| POST | `/v1/permissions/:id/revoke` | Revoke + `permission.revoked` | Bearer + `permission:admin` |

Task creation is idempotent when `Idempotency-Key` is present: the key, the task
and its event commit together, and a replay returns the original task with
status `200` and `Idempotency-Replayed: true`.

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

## 9. Authentication and security hygiene

Every `/v1` request presents a **per-identity credential**. The server hashes the
token, resolves it against `nexora.identity_credentials`, and derives the actor
from the joined identity. Body fields such as `createdBy`, `actorId`,
`proposedBy` and `decidedBy` no longer exist; sending them is a validation error.

Credential properties:

- 256-bit random token; only a SHA-256 hex digest is stored.
- Bound to exactly one identity; revoked and expired credentials fail closed.
- Issued by an operator script (`npm --prefix apps/core run credential:issue`),
  never by an HTTP endpoint.
- `last_used_at` is updated best-effort on each authenticated request.

Direct Supabase clients use a separate path: `nexora.current_actor_id()` maps the
Supabase JWT `sub` through `identities.auth_user_id` and returns `NULL` for
unmapped users. RLS then denies access. It previously returned the raw `sub`,
which is an `auth.users` id and not a NEXORA identity id.

Remaining Phase 0 constraints:

- No rate limiting or per-identity request budget yet.
- No credential rotation UI; rotate by issuing a new credential and revoking the
  old one.
- No realtime delivery; consumers poll.
- Console is unauthenticated status only, with no credential in its bundle.
- NILA's Tier B adapter polls task and event endpoints over the typed HTTP SDK.
  It does not provide push delivery, remote triggering, or VS Code/Copilot
  extension wiring; the host supplies NILA's per-identity credential at runtime.
- No backup, retention or export policy defined.

## 10. Configuration

See `.env.example` files. Rules:

- `NODE_ENV=production` refuses to start without `DATABASE_URL`.
- `DATABASE_SSL=require` for Supabase Cloud, `disable` for the local stack.
- Secrets are never committed; `.env*` is ignored except examples.
- The console receives only `VITE_NEXORA_API_URL`. Vite inlines `VITE_*` values
  into public JavaScript, so it must never receive a credential.

## 11. Definition of done

- [x] Workspace, TypeScript references and package boundaries exist.
- [x] Contracts cover identities, events, tasks, decisions, permissions.
- [x] Core API skeleton with liveness and readiness.
- [x] Migrations for PostgreSQL/Supabase with append-only events and RLS.
- [x] EV Tier A and NILA Tier B pull-only adapters; Tier C relays (RIN, ELIO).
- [x] Environment examples, README, ADR and this spec.
- [x] Migrations executed against PostgreSQL — PGlite 0.5.13 (PostgreSQL 18.6,
  WASM build); no native PostgreSQL server and no Docker on this machine.
- [x] Database-layer smoke test: seed → create task → transition → append-only
  event history, including negative permission and immutability cases.
- [x] Per-identity authentication implemented and approved (ADR-002).
- [x] Security remediation for ELIO review findings 1–13, with regression tests.
- [ ] `supabase db push` against Supabase Cloud (requires project ref + credentials).
- [ ] HTTP API end-to-end run against a live Supabase-hosted PostgreSQL instance.
- [ ] NILA transport decision recorded in an ADR.
- [ ] Credential rotation and rate limiting.
- [ ] Jana review of the remediation.

## 12. Verification record

Completed by EV with real command output. Nothing here is marked passed without
evidence.

| Check | Command | Result |
| --- | --- | --- |
| Install | `corepack pnpm install` | **PASS** — pnpm 12.16.1, 130 packages |
| Typecheck | `corepack pnpm typecheck` | **PASS** — tsc project references + console |
| Tests | `corepack pnpm test` | **PASS** — 63 tests (contracts 15, SDK 8, core 40) |
| Build | `corepack pnpm build` | **PASS** — Core/adapters `tsc -b`, console Vite bundle |
| Liveness | `GET /health` | **PASS** — HTTP 200, contract-valid JSON |
| Readiness (no DB) | `GET /health/ready` | **PASS** — HTTP 503, `database.status = not_configured` |
| Auth (no token) | `GET /v1/whoami` | **PASS** — HTTP 401 |
| Auth (revoked/expired) | credential probes | **PASS** — HTTP 401 for both |
| Identity admin | `POST /v1/identities` as EV / as Jana | **PASS** — 403 / 201 with `identity.created` actor = Jana |
| Impersonation | `createdBy` / `actorId` / `proposedBy` / `decidedBy` in body | **PASS** — HTTP 400, zero rows written |
| Domain event forgery | `POST /v1/events` with `task.created` | **PASS** — HTTP 400, no event appended |
| Direct DB writes | `SET ROLE authenticated` + INSERT/UPDATE | **PASS** — permission denied on tasks and decisions |
| Direct DB reads | `SET ROLE authenticated` as mapped ELIO | **PASS** — reads permitted by `task:read` |
| Task claim | two claims, same task | **PASS** — second claim 409, exactly one `task.assigned` |
| Assignment | assign / release / stale version | **PASS** — versions 2, 3; stale 409 |
| Idempotency | same `Idempotency-Key` twice | **PASS** — 201 then 200 + replay header, 1 task, 1 event |
| Permission admin | grant / duplicate / revoke | **PASS** — 201 / 409 / 200; revoked grant stops access |
| Partial indexes | sentinel-UUID scope + global grant | **PASS** — both grants coexist |
| auth.users mapping | `current_actor_id()` with `auth_user_id` | **PASS** — maps correctly; raw identity id returns NULL |
| Enum parameters | `GET /v1/tasks?status=…` | **PASS** — filter works; invalid value rejected at contract |
| Console bundle | `dist/assets/*.js` grep | **PASS** — no `Bearer`, `apiToken`, `authorization` or `VITE_NEXORA_API_TOKEN` |
| Migrations (DB engine) | PGlite 0.5.13 — PostgreSQL 18.6 | **PASS** — `init` + `permissions` + `security_hardening` applied; not yet applied to Supabase Cloud |
| Seed | `seed.sql` ×2 | **PASS** — 5 identities, 20 grants; second run is idempotent |
| Append-only events | `UPDATE` / `TRUNCATE` on `nexora.events` | **PASS** — both rejected by trigger |
| Decision integrity | approve without decider | **PASS** — rejected by constraint; valid approval succeeds |
| Supabase Cloud push | `supabase db push` | **BLOCKED** — no CLI project link or credentials; requires Jana |
| Hosted end-to-end | API against Supabase Cloud | **BLOCKED** — needs a provisioned project |

Verification date: 2026-10-31, Windows, Node 24.22.1.

Environment note: database checks run through `@electric-sql/pglite`, a real
PostgreSQL 18.6 build compiled to WebAssembly. The integration suite applies the
actual migration files and `seed.sql` from `infra/supabase`, then drives the real
Fastify app through `app.inject`, so route, repository and RLS behaviour are
exercised together without Docker. Supabase-specific behaviour (hosted Auth JWT
signing, pooler, service-role binding) still needs the Cloud run.
