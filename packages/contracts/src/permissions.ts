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
  includeRevoked: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .optional(),
});
export type ListPermissionsQuery = z.infer<typeof listPermissionsQuerySchema>;

/**
 * Grant a permission. `grantedBy` is derived from the verified credential; the
 * caller must hold `permission:admin` (owner tier bypasses grants).
 */
export const grantPermissionInputSchema = z.strictObject({
  identityId: identifierSchema,
  resourceType: permissionResourceSchema,
  resourceId: identifierSchema.nullable().default(null),
  action: permissionActionSchema,
  expiresAt: isoDateTimeSchema.nullable().default(null),
});
export type GrantPermissionInput = z.input<typeof grantPermissionInputSchema>;
/** Parsed grant input with defaults applied. */
export type GrantPermissionData = z.output<typeof grantPermissionInputSchema>;
