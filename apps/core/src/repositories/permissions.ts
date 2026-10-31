import type { Permission } from "@nexora/contracts";
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

export async function listPermissions(
  q: Queryable,
  identityId?: string,
): Promise<Permission[]> {
  const rows = await q.query<PermissionRow>(
    `select ${COLUMNS}
       from nexora.permissions
      where ($1::uuid is null or identity_id = $1)
      order by granted_at desc`,
    [identityId ?? null],
  );

  return rows.map(mapPermission);
}

export async function isAllowed(
  q: Queryable,
  identityId: string,
  resourceType: Permission["resourceType"],
  action: Permission["action"],
  resourceId: string | null = null,
): Promise<boolean> {
  const rows = await q.query<{ allowed: boolean }>(
    `select nexora.has_permission($1, $2, $3, $4) as allowed`,
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
