-- NEXORA Phase 0 — explicit permissions and row level security
--
-- The Core API connects with a privileged role and enforces permissions via
-- `nexora.has_permission`. Direct Supabase clients (authenticated role) are
-- additionally constrained by RLS so the same rules apply outside the API.

create type nexora.permission_resource as enum (
  'identity',
  'task',
  'decision',
  'event',
  'permission'
);

create type nexora.permission_action as enum (
  'read',
  'write',
  'approve',
  'admin'
);

create table nexora.permissions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references nexora.identities (id) on delete cascade,
  resource_type nexora.permission_resource not null,
  -- NULL means "every resource of this type".
  resource_id uuid,
  action nexora.permission_action not null,
  granted_by uuid not null references nexora.identities (id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references nexora.identities (id),
  constraint permissions_expiry_after_grant
    check (expires_at is null or expires_at > granted_at),
  constraint permissions_revocation_pair
    check ((revoked_at is null) = (revoked_by is null))
);

create unique index permissions_active_unique_idx
  on nexora.permissions (
    identity_id,
    resource_type,
    coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid),
    action
  )
  where revoked_at is null;

create index permissions_identity_idx
  on nexora.permissions (identity_id, resource_type, action);

-- Supabase sets request.jwt.claim.sub for authenticated requests. Using the
-- setting directly keeps these policies usable on plain PostgreSQL too.
create function nexora.current_actor_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create function nexora.has_permission(
  p_identity_id uuid,
  p_resource_type nexora.permission_resource,
  p_action nexora.permission_action,
  p_resource_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = nexora, pg_temp
as $$
  select
    exists (
      select 1
        from nexora.identities i
       where i.id = p_identity_id
         and i.status = 'active'
         and i.tier = 'owner'
    )
    or exists (
      select 1
        from nexora.permissions p
        join nexora.identities i
          on i.id = p.identity_id
         and i.status = 'active'
       where p.identity_id = p_identity_id
         and p.resource_type = p_resource_type
         and p.action = p_action
         and p.revoked_at is null
         and (p.expires_at is null or p.expires_at > now())
         and (p.resource_id is null or p.resource_id = p_resource_id)
    );
$$;

alter table nexora.identities enable row level security;
alter table nexora.tasks enable row level security;
alter table nexora.decisions enable row level security;
alter table nexora.events enable row level security;
alter table nexora.permissions enable row level security;

create policy identities_select on nexora.identities
  for select
  to authenticated
  using (nexora.current_actor_id() is not null);

create policy tasks_select on nexora.tasks
  for select
  to authenticated
  using (nexora.has_permission(nexora.current_actor_id(), 'task', 'read', id));

create policy tasks_insert on nexora.tasks
  for insert
  to authenticated
  with check (
    created_by = nexora.current_actor_id()
    and nexora.has_permission(nexora.current_actor_id(), 'task', 'write', null)
  );

create policy tasks_update on nexora.tasks
  for update
  to authenticated
  using (nexora.has_permission(nexora.current_actor_id(), 'task', 'write', id))
  with check (nexora.has_permission(nexora.current_actor_id(), 'task', 'write', id));

create policy decisions_select on nexora.decisions
  for select
  to authenticated
  using (
    proposed_by = nexora.current_actor_id()
    or nexora.has_permission(nexora.current_actor_id(), 'decision', 'read', id)
  );

create policy decisions_insert on nexora.decisions
  for insert
  to authenticated
  with check (
    proposed_by = nexora.current_actor_id()
    and nexora.has_permission(nexora.current_actor_id(), 'decision', 'write', null)
  );

create policy decisions_update on nexora.decisions
  for update
  to authenticated
  using (
    nexora.has_permission(nexora.current_actor_id(), 'decision', 'approve', id)
  )
  with check (
    nexora.has_permission(nexora.current_actor_id(), 'decision', 'approve', id)
  );

create policy events_select on nexora.events
  for select
  to authenticated
  using (
    visibility = 'public'
    or nexora.has_permission(
      nexora.current_actor_id(),
      'event',
      'read',
      aggregate_id
    )
  );

create policy permissions_select on nexora.permissions
  for select
  to authenticated
  using (
    identity_id = nexora.current_actor_id()
    or nexora.has_permission(
      nexora.current_actor_id(),
      'permission',
      'admin',
      null
    )
  );

-- Only the service role writes events or grants permissions. Authenticated
-- clients can read them, subject to the policies above.
grant usage on schema nexora to authenticated;

grant select on nexora.identities to authenticated;
grant select, insert, update on nexora.tasks to authenticated;
grant select, insert, update on nexora.decisions to authenticated;
grant select on nexora.events to authenticated;
grant select on nexora.permissions to authenticated;

grant execute on function nexora.current_actor_id() to authenticated;
grant execute on function nexora.has_permission(
  uuid,
  nexora.permission_resource,
  nexora.permission_action,
  uuid
) to authenticated;
