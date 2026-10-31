import { z } from "zod";
import { identifierSchema, isoDateTimeSchema } from "./primitives.js";

export const PERMISSION_RESOURCES = [
  "identity",
  "task",
  "decision",
  "event",
  "permission",
] as const;
export const permissionResourceSchema = z.enum(PERMISSION_RESOURCES);
export type PermissionResource = z.infer<typeof permissionResourceSchema>;

export const PERMISSION_ACTIONS = [
  "read",
  "write",
  "approve",
  "admin",
] as const;
export const permissionActionSchema = z.enum(PERMISSION_ACTIONS);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

export const permissionSchema = z.object({
  id: identifierSchema,
  identityId: identifierSchema,
  resourceType: permissionResourceSchema,
  resourceId: identifierSchema.nullable(),
  action: permissionActionSchema,
  grantedBy: identifierSchema,
  grantedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  revokedBy: identifierSchema.nullable(),
});
export type Permission = z.infer<typeof permissionSchema>;

export const permissionListSchema = z.object({
  items: z.array(permissionSchema),
});
export type PermissionList = z.infer<typeof permissionListSchema>;

export const listPermissionsQuerySchema = z.object({
  identityId: identifierSchema.optional(),
});
export type ListPermissionsQuery = z.infer<typeof listPermissionsQuerySchema>;
