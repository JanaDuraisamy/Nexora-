# NEXORA

**One Family. Five Identities. Infinite Possibilities.**

NEXORA is a hub-and-spoke workspace where Jana and four AI identities — RIN,
NILA, ELIO and EV — share one durable, permissioned state instead of four
disconnected contexts.

> Phase 0 foundation: **EV and NILA are the direct-integration targets; RIN and
> ELIO use honest human relay.** No 3D house, no simulated integrations, no
> FINORA changes.

## Architecture

```
 EV (OpenCode) ──┐
                 │  Tier A
 NILA (Copilot) ─┤
                 ▼
          ┌──────────────┐        ┌────────────────────────┐
          │  Core API    │───────▶│ PostgreSQL (Supabase)  │
          │  Fastify     │  SQL   │ aggregates + events    │
          └──────────────┘        │ permissions + RLS      │
                 ▲                └────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │ Tier C relays       │
      │ Jana carries RIN /  │
      │ ELIO input to hub   │
      └─────────────────────┘
```

- **Central authority.** Only the Core API writes shared state.
- **Durable history.** Every change appends an immutable event with an actor,
  correlation and schema version.
- **Explicit permissions.** Grants are per identity, resource and action. Owners
  pass by role; everyone else needs a grant.
- **Contracts first.** Zod schemas are shared by the API, SDK and adapters.
- **PostgreSQL only.** No Redis in Phase 0.

Read [ADR-001](docs/adr/ADR-001-core-architecture.md) and the
[Phase 0 spec](docs/specs/phase-0-foundation.md) for the full reasoning and
current limitations.

## Repository layout

```
apps/
  core/               Fastify Core API
  console/            Minimal 2D status console (Vite + React)
packages/
  contracts/          Shared Zod contracts
  sdk-ts/             Typed TypeScript client
adapters/
  ev-opencode/        Tier A — EV
  nila-copilot/       Tier B pull-only — NILA
  elio-relay/         Tier C — ELIO via Jana
  rin-bridge/         Tier C — RIN via Jana
infra/
  supabase/           Migrations, seed, deployment notes
docs/
  adr/                Architecture decision records
  specs/              Phase specifications
```

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24.x | `node --version` |
| pnpm | 12.16.1 | `corepack enable` then `corepack pnpm --version` |
| PostgreSQL | 15+ | Or Supabase CLI local stack |
| Supabase CLI | current | Only needed for migrations |

## Quick start

```bash
# 1. Install workspace dependencies
corepack pnpm install

# 2. Build shared packages and apps
corepack pnpm build

# 3. Verify types and tests
corepack pnpm typecheck
corepack pnpm test

# 4. Configure the API
cp apps/core/.env.example apps/core/.env
#    Set DATABASE_URL / DATABASE_SSL.

# 5. Issue a per-identity credential (plaintext shown once)
npm --prefix apps/core run credential:issue -- --handle ev --label "EV local"

# 6. Run the Core API
corepack pnpm dev:core
#    GET http://127.0.0.1:4000/health
#    GET http://127.0.0.1:4000/health/ready

# 7. Optional: run the console in another terminal
corepack pnpm dev:console
#    http://localhost:5173
```

`pnpm typecheck` uses TypeScript project references, so run it after `install`
and let it build dependencies in order. Editors may report unresolved
`@nexora/*` imports until the first build.

### Database

```bash
cd infra
supabase init        # once: generates infra/supabase/config.toml
supabase start
supabase db reset    # migrations + seed.sql
```

See [infra/supabase/README.md](infra/supabase/README.md). The reference seed
creates identities `jana`, `ev`, `nila`, `elio`, `rin` with Phase 0 grants.

The migrations and seed have been executed against PostgreSQL 18.6 through
PGlite (WebAssembly). Applying them to Supabase Cloud is still outstanding — see
the verification record in `docs/specs/phase-0-foundation.md`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every package and app in dependency order |
| `pnpm typecheck` | TypeScript project-reference build + console typecheck |
| `pnpm test` | Vitest suites (contracts, SDK, Core API) |
| `pnpm dev:core` | Run Core API with watch mode |
| `pnpm dev:console` | Run the Vite console |
| `pnpm db:reset` | Reset local Supabase DB (requires CLI) |
| `pnpm db:push` | Push migrations to the linked Supabase project |

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /health/ready` | Database readiness; 503 when degraded |
| `GET /v1/whoami` | Identity bound to the presented credential |
| `GET /v1/events` | Read event history (cursor pagination) |
| `POST /v1/events` | Append a non-domain note; domain events are Core-only |
| `POST /v1/tasks` | Create a task and its event (supports `Idempotency-Key`) |
| `POST /v1/tasks/:id/status` | Transition a task with optimistic concurrency |
| `POST /v1/tasks/:id/assign` | Assign or release a task |
| `POST /v1/tasks/:id/claim` | Atomically claim an unassigned task |
| `POST /v1/decisions` | Propose a decision |
| `POST /v1/decisions/:id/decide` | Approve or reject (requires permission) |
| `POST /v1/identities` | Create an identity (requires `identity:admin`) |
| `GET /v1/identities`, `GET /v1/permissions` | Inspect identities and grants |
| `POST /v1/permissions` | Grant a permission (requires `permission:admin`) |
| `POST /v1/permissions/:id/revoke` | Revoke a grant (requires `permission:admin`) |

Every `/v1` route requires a per-identity bearer credential. The acting identity
is always derived server-side; request bodies cannot name a different actor.

Full detail: [docs/specs/phase-0-foundation.md](docs/specs/phase-0-foundation.md).

## Security rules

- Never commit `.env` files, tokens, API keys or database credentials.
- The Supabase service role key lives only in the Core API server environment.
- Each identity has its own credential. Only a SHA-256 digest is stored, and the
  plaintext is shown once by `credential:issue`.
- The browser console never receives a credential; it only calls public health
  endpoints.
- RLS is enabled on all domain tables. Direct authenticated clients are
  read-only and bounded by the same permission function as the API.

## Phase 0 boundaries

Implemented: workspace, contracts, SDK, API skeleton, migrations, permission
model, per-identity credentials, task assignment and idempotency, adapter
skeletons, health endpoints, docs.

Not implemented: live RIN/ELIO channels, 3D house, realtime push, rate limiting,
credential rotation UI, permission administration UI, production deployment
topology.

## Documentation

- [ADR-001 — Core architecture](docs/adr/ADR-001-core-architecture.md)
- [ADR-002 — Per-identity credentials](docs/adr/ADR-002-identity-credentials.md)
- [Phase 0 foundation spec](docs/specs/phase-0-foundation.md)
- [Database infrastructure](infra/supabase/README.md)

FINORA is a separate project and is not touched by this repository.
