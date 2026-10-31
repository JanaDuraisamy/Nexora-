import {
  listPermissionsQuerySchema,
  permissionListSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.js";
import { parseInput } from "../http/validation.js";
import { listPermissions } from "../repositories/permissions.js";

export interface PermissionRoutesOptions {
  db: Database;
}

export const permissionRoutes: FastifyPluginAsync<
  PermissionRoutesOptions
> = async (app, options) => {
  app.get("/permissions", async (request) => {
    const query = parseInput(listPermissionsQuerySchema, request.query);
    const items = await listPermissions(options.db, query.identityId);
    return permissionListSchema.parse({ items });
  });
};
