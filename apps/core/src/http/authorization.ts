import type {
  Identity,
  PermissionAction,
  PermissionResource,
} from "@nexora/contracts";
import type { Queryable } from "../db.js";
import { forbidden, notFound } from "../http/errors.js";
import { findIdentityById } from "../repositories/identities.js";
import { isAllowed } from "../repositories/permissions.js";

export async function requireActiveIdentity(
  q: Queryable,
  identityId: string,
): Promise<Identity> {
  const identity = await findIdentityById(q, identityId);
  if (!identity) {
    throw notFound(`Identity ${identityId} was not found`);
  }

  if (identity.status !== "active") {
    throw forbidden(`Identity ${identity.handle} is ${identity.status}`);
  }

  return identity;
}

/**
 * Permission enforcement happens in PostgreSQL (`nexora.has_permission`) so
 * that the API and direct Supabase clients share one rule set. Owners bypass
 * the grants table by design.
 */
export async function requirePermission(
  q: Queryable,
  identityId: string,
  resourceType: PermissionResource,
  action: PermissionAction,
  resourceId: string | null = null,
): Promise<void> {
  const allowed = await isAllowed(q, identityId, resourceType, action, resourceId);
  if (!allowed) {
    throw forbidden(
      `Identity ${identityId} lacks '${action}' permission on ${resourceType}` +
        (resourceId === null ? "" : ` ${resourceId}`),
    );
  }
}
