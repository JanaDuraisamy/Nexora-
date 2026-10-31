import {
  grantPermissionInputSchema,
  listPermissionsQuerySchema,
  permissionListSchema,
  permissionSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DatabasePort } from "../db.js";
import { currentActor } from "../http/actor.js";
import {
  requireActiveIdentity,
  requirePermission,
} from "../http/authorization.js";
import { conflict, notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
import { appendEvent } from "../repositories/events.js";
import {
  findPermissionById,
  grantPermission,
  listPermissions,
  revokePermission,
} from "../repositories/permissions.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface PermissionRoutesOptions {
  db: DatabasePort;
}

export const permissionRoutes: FastifyPluginAsync<
  PermissionRoutesOptions
> = async (app, options) => {
  /**
   * List grants.
   *
   * Any identity may inspect its own grants. Reading someone else's grants, or
   * including revoked ones, requires `permission:admin`.
   */
  app.get("/permissions", async (request) => {
    const actor = currentActor(request);
    const query = parseInput(listPermissionsQuerySchema, request.query);

    const identityId = query.identityId ?? actor.id;
    const includeRevoked = query.includeRevoked ?? false;

    if (identityId !== actor.id || includeRevoked) {
      await requirePermission(options.db, actor.id, "permission", "admin");
    }

    const items = await listPermissions(options.db, {
      identityId,
      includeRevoked,
    });

    return permissionListSchema.parse({ items });
  });

  /**
   * Grant a permission. Restricted to `permission:admin` (owner bypasses).
   *
   * `granted_by` is the authenticated actor; the body cannot claim a different
   * issuer. The grant and its `permission.granted` event commit together.
   */
  app.post("/permissions", async (request, reply) => {
    const actor = currentActor(request);
    const input = parseInput(grantPermissionInputSchema, request.body);

    const permission = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "permission", "admin");
      await requireActiveIdentity(q, input.identityId);

      const created = await grantPermission(q, input, actor.id);
      if (!created) {
        throw conflict(
          "An identical active grant already exists for this identity",
        );
      }

      await appendEvent(q, {
        type: "permission.granted",
        aggregateType: "permission",
        aggregateId: created.id,
        actorId: actor.id,
        payload: {
          identityId: created.identityId,
          resourceType: created.resourceType,
          resourceId: created.resourceId,
          action: created.action,
          expiresAt: created.expiresAt,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return created;
    });

    reply.code(201);
    return permissionSchema.parse(permission);
  });

  /**
   * Revoke a grant. Restricted to `permission:admin`.
   *
   * Revocation is a soft delete: the row stays for audit, `revoked_at` makes
   * `nexora.has_permission` fail immediately, and an event records who did it.
   */
  app.post("/permissions/:id/revoke", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);

    const permission = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "permission", "admin");

      const existing = await findPermissionById(q, id);
      if (!existing) {
        throw notFound(`Permission ${id} was not found`);
      }

      if (existing.revokedAt !== null) {
        throw conflict(`Permission ${id} is already revoked`);
      }

      const revoked = await revokePermission(q, id, actor.id);
      if (!revoked) {
        throw conflict("Permission was modified concurrently; reload and retry");
      }

      await appendEvent(q, {
        type: "permission.revoked",
        aggregateType: "permission",
        aggregateId: revoked.id,
        actorId: actor.id,
        payload: {
          identityId: revoked.identityId,
          resourceType: revoked.resourceType,
          resourceId: revoked.resourceId,
          action: revoked.action,
          revokedAt: revoked.revokedAt,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return revoked;
    });

    return permissionSchema.parse(permission);
  });
};
