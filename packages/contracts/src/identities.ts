import { z } from "zod";
import {
  handleSchema,
  identifierSchema,
  isoDateTimeSchema,
  metadataSchema,
  requiredText,
} from "./primitives.js";

/** Human or AI participant in the NEXORA family. */
export const IDENTITY_KINDS = ["human", "ai_agent"] as const;
export const identityKindSchema = z.enum(IDENTITY_KINDS);
export type IdentityKind = z.infer<typeof identityKindSchema>;

/**
 * Integration tiers.
 *
 * - owner:  Jana, final decision authority.
 * - tier_a: direct API integration (native tooling).
 * - tier_b: process/extension bridge (reserved; no Phase 0 consumer yet).
 * - tier_c: human-relay adapter (a human carries messages to/from the identity).
 */
export const IDENTITY_TIERS = ["owner", "tier_a", "tier_b", "tier_c"] as const;
export const identityTierSchema = z.enum(IDENTITY_TIERS);
export type IdentityTier = z.infer<typeof identityTierSchema>;

export const IDENTITY_STATUSES = ["active", "paused", "retired"] as const;
export const identityStatusSchema = z.enum(IDENTITY_STATUSES);
export type IdentityStatus = z.infer<typeof identityStatusSchema>;

export const identitySchema = z.object({
  id: identifierSchema,
  handle: handleSchema,
  displayName: requiredText(120),
  kind: identityKindSchema,
  tier: identityTierSchema,
  status: identityStatusSchema,
  adapterKey: z.string().max(64).nullable(),
  metadata: metadataSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Identity = z.infer<typeof identitySchema>;

export const createIdentityInputSchema = z.strictObject({
  handle: handleSchema,
  displayName: requiredText(120),
  kind: identityKindSchema,
  tier: identityTierSchema,
  status: identityStatusSchema.default("active"),
  adapterKey: z.string().trim().min(1).max(64).nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type CreateIdentityInput = z.infer<typeof createIdentityInputSchema>;

export const identityListSchema = z.object({
  items: z.array(identitySchema),
});
export type IdentityList = z.infer<typeof identityListSchema>;
