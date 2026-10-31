# ADR-002 — Per-identity API credentials

- **Status:** ACCEPTED
- **Date:** 2026-10-31
- **Decision owner:** Jana
- **Approval:** Jana selected this model during the ELIO security-review
  remediation session (2026-10-31). This record is written after the decision;
  it does not alter ADR-001's status or proposal text.
- **Resolves:** ADR-001 open question #1 — *"When does the shared token become
  per-identity credentials, and what issues them?"*

## Context

ADR-001 and the Phase 0 spec deliberately shipped a single shared bearer token
and recorded the consequences as security debt: possession of the token was
enough to name any identity in a request body. ELIO's independent read-only
review confirmed two exploitable outcomes:

1. `POST /v1/identities` was reachable by any token holder.
2. `createdBy`, `actorId`, `proposedBy` and `decidedBy` were trusted from the
   request body, so any caller could attribute work and decisions to Jana.

The architecture decision — PostgreSQL as the source of truth, explicit
permissions, hub-and-spoke authority — was already approved. What remained open
was the authentication mechanism.

## Decision

NEXORA authenticates each caller with a **per-identity API key**.

- A credential is bound to exactly one row in `nexora.identities`.
- Only a SHA-256 hex digest is stored, in `nexora.identity_credentials`. A fast
  hash is appropriate because tokens are 256-bit random values; this is not
  password storage.
- The plaintext token is printed once by an operator script
  (`npm --prefix apps/core run credential:issue -- --handle <handle>`). There is
  no HTTP endpoint that issues credentials.
- Credentials are revocable and can expire. Revoked, expired and unknown
  credentials are indistinguishable to a caller and all fail closed.
- The Core API derives the actor from the credential on every `/v1` request.
  Request bodies may never supply an actor.
- Direct Supabase clients use a different path: a Supabase JWT resolves through
  `nexora.identities.auth_user_id`, which maps `auth.users.id` to a NEXORA
  identity. An unmapped user resolves to `NULL` and sees nothing.
- `NEXORA_API_TOKEN` is retired as a hub-wide token. The same variable name is
  reused by adapters to hold **their own** credential.

## Consequences

Positive:

- Actor attribution is trustworthy, which makes the append-only event log
  meaningful for audit.
- A leaked credential affects one identity, not the whole hub.
- Revocation is immediate (`revoked_at`) without a redeploy.
- The model is testable locally without Supabase Auth.

Negative / accepted trade-offs:

- Credential issuance is an operator action, not self-service.
- There is no rotation schedule or UI yet; rotation means issuing a new
  credential and revoking the old one manually.
- Rate limiting per identity is still missing.
- Supabase JWT access depends on `auth_user_id` being populated correctly per
  human identity; unmapped humans are denied by design.

## Alternatives considered

| Alternative | Why not chosen now |
| --- | --- |
| Keep the shared token | Cannot satisfy "no actor impersonation"; every caller could still act as Jana |
| Supabase Auth JWT only | Not verifiable on this machine and blocks AI adapters until each agent has an `auth.users` row |
| Hybrid JWT (humans) + keys (agents) | Strongest long term, but doubles the auth surface and test matrix in one remediation pass |

## Follow-up

- Rate limiting and request budgets per identity.
- Credential rotation and revocation UI.
- Audit alerts for owner-tier actions.
- Revisit the hybrid model when a real Supabase Auth requirement appears.
