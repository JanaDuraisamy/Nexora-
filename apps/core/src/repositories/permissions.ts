import type { GrantPermissionData, Permission } from "@nexora/contracts";
import type { Queryable } from "../db.js";

interface PermissionRow {
  id: string;
  identity_id: string;
  resource_type: Permission["resourceType"];
  resource_id: string | null;
  action: Permission["action"];
  granted_by: string;
  granted_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
}

const COLUMNS = `
  id, identity_id, resource_type, resource_id, action, granted_by, granted_at,
  expires_at, revoked_at, revoked_by
`;

export interface PermissionFilters {
  identityId?: string;
  /** Revoked grants are hidden by default; auditing needs them explicitly. */
  includeRevoked: boolean;
}

export async function listPermissions(
  q: Queryable,
  filters: PermissionFilters,
): Promise<Permission[]> {
  const rows = await q.query<PermissionRow>(
    `select ${COLUMNS}
       from nexora.permissions
      where ($1::uuid is null or identity_id = $1::uuid)
        and ($2::boolean or revoked_at is null)
      order by granted_at desc`,
    [filters.identityId ?? null, filters.includeRevoked],
  );

  return rows.map(mapPermission);
}

export async function findPermissionById(
  q: Queryable,
  id: string,
): Promise<Permission | null> {
  const rows = await q.query<PermissionRow>(
    `select ${COLUMNS} from nexora.permissions where id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? mapPermission(row) : null;
}

/**
 * Insert a grant. Returns `null` when an identical active grant already exists,
 * which the route reports as a conflict instead of silently duplicating it.
 */
export async function grantPermission(
  q: Queryable,
  input: GrantPermissionData,
  grantedBy: string,
): Promise<Permission | null> {
  const rows = await q.query<PermissionRow>(
    `insert into nexora.permissions
       (identity_id, resource_type, resource_id, action, granted_by, expires_at)
     values ($1, $2::nexora.permission_resource, $3, $4::nexora.permission_action,
             $5, $6::timestamptz)
     on conflict do nothing
     returning ${COLUMNS}`,
    [
      input.identityId,
      input.resourceType,
      input.resourceId,
      input.action,
      grantedBy,
      input.expiresAt,
    ],
  );

  const row = rows[0];
  return row ? mapPermission(row) : null;
}

/** Revoke an active grant. Returns `null` when it was already revoked or absent. */
export async function revokePermission(
  q: Queryable,
  id: string,
  revokedBy: string,
): Promise<Permission | null> {
  const rows = await q.query<PermissionRow>(
    `update nexora.permissions
        set revoked_at = now(),
            revoked_by = $2
      where id = $1
        and revoked_at is null
      returning ${COLUMNS}`,
    [id, revokedBy],
  );

  const row = rows[0];
  return row ? mapPermission(row) : null;
}

export async function isAllowed(
  q: Queryable,
  identityId: string,
  resourceType: Permission["resourceType"],
  action: Permission["action"],
  resourceId: string | null = null,
): Promise<boolean> {
  const rows = await q.query<{ allowed: boolean }>(
    `select nexora.has_permission($1, $2::nexora.permission_resource,
                                  $3::nexora.permission_action, $4) as allowed`,
    [identityId, resourceType, action, resourceId],
  );

  return rows[0]?.allowed ?? false;
}

function mapPermission(row: PermissionRow): Permission {
  return {
    id: row.id,
    identityId: row.identity_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    revokedBy: row.revoked_by,
  };
}
