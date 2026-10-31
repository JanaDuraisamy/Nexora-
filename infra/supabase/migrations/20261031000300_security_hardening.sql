-- NEXORA Phase 0 — security hardening (ELIO review remediation)
--
-- Addresses:
--   2/6  Per-identity credentials and a correct auth.users -> identity mapping.
--   4    Removes direct authenticated writes on tasks and decisions.
--   13   Replaces the sentinel-UUID uniqueness hack with partial indexes.
--
-- Design notes:
--   * Tokens are 256-bit random values. Only the SHA-256 hex digest is stored, so
--     a database leak does not expose usable credentials and the lookup stays an
--     indexed equality probe. A fast hash is appropriate here because the input
--     is high-entropy; this is not password storage.
--   * `identity_credentials` is service-role only: RLS is enabled and no grants
--     are issued to `authenticated` or `anon`.
--   * The Core API is the only writer of domain aggregates. Direct Supabase
--     clients keep read access subject to permissions.

-- ---------------------------------------------------------------------------
-- 1. Per-identity credentials
-- ---------------------------------------------------------------------------

create table nexora.identity_credentials (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references nexora.identities (id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null
    check (char_length(label) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid references nexora.identities (id),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references nexora.identities (id),
  constraint credentials_revocation_pair
    check ((revoked_at is null) = (revoked_by is null)),
  constraint credentials_expiry_after_creation
    check (expires_at is null or expires_at > created_at)
);

create index credentials_identity_active_idx
  on nexora.identity_credentials (identity_id)
  where revoked_at is null;

alter table nexora.identity_credentials enable row level security;

comment on table nexora.identity_credentials is
  'Hashed per-identity API credentials. Service-role access only; no grants to authenticated/anon.';

-- ---------------------------------------------------------------------------
-- 2. Supabase auth.users -> NEXORA identity mapping
-- ---------------------------------------------------------------------------
-- The column is a plain uuid rather than a foreign key because `auth.users`
-- only exists on Supabase; migrations must also apply to plain PostgreSQL.
-- Unmapped users resolve to NULL, which fails closed under RLS.

alter table nexora.identities
  add column auth_user_id uuid;

create unique index identities_auth_user_id_idx
  on nexora.identities (auth_user_id)
  where auth_user_id is not null;

comment on column nexora.identities.auth_user_id is
  'Supabase auth.users.id for human identities. NULL means no direct JWT access.';

-- The previous implementation returned the raw JWT `sub`, which is an
-- auth.users id and NOT a NEXORA identity id. It now maps through the table and
-- only resolves active identities.
create or replace function nexora.current_actor_id()
returns uuid
language sql
stable
security definer
set search_path = nexora, pg_temp
as $$
  select i.id
    from nexora.identities i
   where i.auth_user_id = (
           select coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           )::uuid
         )
     and i.status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- 3. Direct authenticated writes on tasks and decisions are removed
-- ---------------------------------------------------------------------------
-- The Core API writes these aggregates transactionally together with their
-- events. Allowing direct table writes let a client bypass the transition table,
-- optimistic version checks and event emission entirely.

drop policy if exists tasks_insert on nexora.tasks;
drop policy if exists tasks_update on nexora.tasks;
drop policy if exists decisions_insert on nexora.decisions;
drop policy if exists decisions_update on nexora.decisions;

revoke insert, update on nexora.tasks from authenticated;
revoke insert, update on nexora.decisions from authenticated;

-- Read access is preserved and still governed by the select policies, which
-- require an explicit read permission (or ownership of the decision).

-- ---------------------------------------------------------------------------
-- 4. Partial unique indexes instead of a sentinel UUID
-- ---------------------------------------------------------------------------
-- The old index coalesced a NULL resource_id to 00000000-0000-0000-0000-000000000000,
-- so a real grant scoped to that UUID collided with a global grant. Two partial
-- indexes express the same rule without reserving a UUID value.

drop index if exists nexora.permissions_active_unique_idx;

create unique index permissions_active_global_idx
  on nexora.permissions (identity_id, resource_type, action)
  where revoked_at is null and resource_id is null;

create unique index permissions_active_scoped_idx
  on nexora.permissions (identity_id, resource_type, resource_id, action)
  where revoked_at is null and resource_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Idempotency keys
-- ---------------------------------------------------------------------------
-- Scoped to the acting identity and the operation, so two agents cannot collide
-- on the same client-generated key. Rows are written in the same transaction as
-- the resource they protect: a failed request leaves no key behind.

create table nexora.idempotency_keys (
  identity_id uuid not null references nexora.identities (id) on delete cascade,
  scope text not null
    check (char_length(scope) between 1 and 64),
  key text not null
    check (char_length(key) between 8 and 200),
  resource_type nexora.aggregate_type not null,
  payload_hash text not null
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  resource_id uuid,
  created_at timestamptz not null default now(),
  primary key (identity_id, scope, key)
);

alter table nexora.idempotency_keys enable row level security;

comment on table nexora.idempotency_keys is
  'Client-supplied idempotency keys, scoped per identity and operation. Service-role only.';

-- ---------------------------------------------------------------------------
-- 6. Assignment index
-- ---------------------------------------------------------------------------
-- Claiming filters on "assignee_id is null" together with the primary key, so a
-- partial index keeps the common open-task scan cheap.

create index tasks_unassigned_idx
  on nexora.tasks (status)
  where assignee_id is null;
