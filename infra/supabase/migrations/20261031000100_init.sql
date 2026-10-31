-- NEXORA Phase 0 — initial schema
--
-- Durable PostgreSQL is the source of truth. All domain objects live in the
-- `nexora` schema so they cannot collide with Supabase-managed `public` or
-- `auth` objects. Migrations are applied once by the Supabase CLI.
--
-- Design rules:
--   * events is append-only; UPDATE/DELETE/TRUNCATE are rejected by trigger.
--   * aggregates carry an optimistic `version` column.
--   * permissions are explicit grants; owners bypass grants by design.

create schema if not exists nexora;

create type nexora.identity_kind as enum ('human', 'ai_agent');

-- Integration tier. `owner` is Jana. `tier_a` is a direct API integration
-- (EV in Phase 0). `tier_b` is a pull-only process/extension bridge (NILA).
-- `tier_c` is a human-relay adapter (RIN, ELIO).
create type nexora.identity_tier as enum ('owner', 'tier_a', 'tier_b', 'tier_c');

create type nexora.identity_status as enum ('active', 'paused', 'retired');

create type nexora.task_status as enum (
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled'
);

create type nexora.task_priority as enum ('low', 'normal', 'high', 'urgent');

create type nexora.decision_status as enum (
  'proposed',
  'approved',
  'rejected',
  'superseded'
);

create type nexora.aggregate_type as enum (
  'identity',
  'task',
  'decision',
  'permission',
  'system'
);

create type nexora.event_visibility as enum ('internal', 'public');

create table nexora.identities (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique
    check (handle ~ '^[a-z][a-z0-9_-]{1,31}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 120),
  kind nexora.identity_kind not null,
  tier nexora.identity_tier not null,
  status nexora.identity_status not null default 'active',
  adapter_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nexora.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status nexora.task_status not null default 'backlog',
  priority nexora.task_priority not null default 'normal',
  created_by uuid not null references nexora.identities (id),
  assignee_id uuid references nexora.identities (id),
  parent_task_id uuid references nexora.tasks (id),
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_parent_is_not_self
    check (parent_task_id is null or parent_task_id <> id)
);

create table nexora.decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  status nexora.decision_status not null default 'proposed',
  context text not null check (char_length(context) between 1 and 10000),
  resolution text,
  proposed_by uuid not null references nexora.identities (id),
  decided_by uuid references nexora.identities (id),
  decided_at timestamptz,
  adr_path text,
  supersedes_id uuid references nexora.decisions (id),
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decisions_supersedes_is_not_self
    check (supersedes_id is null or supersedes_id <> id),
  constraint decisions_decided_fields
    check (
      status not in ('approved', 'rejected')
      or (
        decided_by is not null
        and decided_at is not null
        and resolution is not null
      )
    )
);

create table nexora.events (
  seq bigint generated always as identity primary key,
  id uuid not null default gen_random_uuid() unique,
  type text not null
    check (type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  aggregate_type nexora.aggregate_type not null,
  aggregate_id uuid,
  actor_id uuid references nexora.identities (id),
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  causation_id uuid,
  schema_version integer not null default 1 check (schema_version >= 1),
  visibility nexora.event_visibility not null default 'internal',
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now()
);

create index events_aggregate_seq_idx
  on nexora.events (aggregate_type, aggregate_id, seq desc);

create index events_actor_idx
  on nexora.events (actor_id, seq desc);

create index events_recorded_at_idx
  on nexora.events (recorded_at desc);

create index tasks_status_idx on nexora.tasks (status);
create index tasks_assignee_idx on nexora.tasks (assignee_id);
create index decisions_status_idx on nexora.decisions (status);

create function nexora.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger identities_set_updated_at
  before update on nexora.identities
  for each row execute function nexora.set_updated_at();

create trigger tasks_set_updated_at
  before update on nexora.tasks
  for each row execute function nexora.set_updated_at();

create trigger decisions_set_updated_at
  before update on nexora.decisions
  for each row execute function nexora.set_updated_at();

-- Event history is durable and append-only. Corrections are new events, not
-- edits to old ones.
create function nexora.reject_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'nexora.events is append-only (% rejected)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger events_reject_update_delete
  before update or delete on nexora.events
  for each row execute function nexora.reject_event_mutation();

create trigger events_reject_truncate
  before truncate on nexora.events
  for each statement execute function nexora.reject_event_mutation();
