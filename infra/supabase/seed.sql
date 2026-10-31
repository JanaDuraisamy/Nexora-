-- NEXORA Phase 0 — reference seed data (development and first bootstrap only)
--
-- These identities are a starting point, not a production provisioning path.
-- Production identities and permission grants should be created through the
-- Core API and reviewed by Jana. UUIDs are stable so local tooling can refer to
-- them, and inserts are idempotent by handle.

insert into nexora.identities
  (id, handle, display_name, kind, tier, status, adapter_key, metadata)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'jana',
    'Jana',
    'human',
    'owner',
    'active',
    null,
    '{"family":"nexora","phase":"0"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'ev',
    'EV',
    'ai_agent',
    'tier_a',
    'active',
    'ev-opencode',
    '{"family":"nexora","phase":"0"}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'nila',
    'NILA',
    'ai_agent',
    'tier_b',
    'active',
    'nila-copilot',
    '{"family":"nexora","phase":"0"}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'elio',
    'ELIO',
    'ai_agent',
    'tier_c',
    'active',
    'elio-relay',
    '{"family":"nexora","phase":"0"}'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'rin',
    'RIN',
    'ai_agent',
    'tier_c',
    'active',
    'rin-bridge',
    '{"family":"nexora","phase":"0"}'::jsonb
  )
on conflict (handle) do update
  set tier = excluded.tier
  where nexora.identities.handle = 'nila';

-- Explicit Phase 0 grants. Jana (owner) needs no rows: owner authority is part
-- of nexora.has_permission by design.
with grants (identity_handle, resource_type, action) as (
  values
    ('ev', 'event', 'read'),
    ('ev', 'event', 'write'),
    ('ev', 'task', 'read'),
    ('ev', 'task', 'write'),
    ('ev', 'decision', 'read'),
    ('ev', 'decision', 'write'),
    ('nila', 'event', 'read'),
    ('nila', 'event', 'write'),
    ('nila', 'task', 'read'),
    ('nila', 'task', 'write'),
    ('nila', 'decision', 'read'),
    ('nila', 'decision', 'write'),
    ('elio', 'event', 'read'),
    ('elio', 'event', 'write'),
    ('elio', 'task', 'read'),
    ('elio', 'decision', 'read'),
    ('rin', 'event', 'read'),
    ('rin', 'event', 'write'),
    ('rin', 'task', 'read'),
    ('rin', 'decision', 'read')
)
insert into nexora.permissions
  (identity_id, resource_type, resource_id, action, granted_by)
select
  member.id,
  grants.resource_type::nexora.permission_resource,
  null,
  grants.action::nexora.permission_action,
  jana.id
from grants
join nexora.identities as member
  on member.handle = grants.identity_handle
cross join nexora.identities as jana
where jana.handle = 'jana'
on conflict do nothing;
