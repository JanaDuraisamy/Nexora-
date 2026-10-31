import { z } from "zod";
import {
  identifierSchema,
  isoDateTimeSchema,
  metadataSchema,
  requiredText,
} from "./primitives.js";

export const DECISION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "superseded",
] as const;
export const decisionStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export const decisionSchema = z.object({
  id: identifierSchema,
  title: requiredText(200),
  status: decisionStatusSchema,
  context: requiredText(10_000),
  resolution: z.string().max(10_000).nullable(),
  proposedBy: identifierSchema,
  decidedBy: identifierSchema.nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  adrPath: z.string().max(512).nullable(),
  supersedesId: identifierSchema.nullable(),
  metadata: metadataSchema,
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Decision = z.infer<typeof decisionSchema>;

export const proposeDecisionInputSchema = z.strictObject({
  title: requiredText(200),
  context: requiredText(10_000),
  proposedBy: identifierSchema,
  adrPath: z.string().trim().max(512).nullable().default(null),
  supersedesId: identifierSchema.nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type ProposeDecisionInput = z.infer<typeof proposeDecisionInputSchema>;

export const decideDecisionInputSchema = z.strictObject({
  status: z.enum(["approved", "rejected"]),
  rationale: requiredText(10_000),
  decidedBy: identifierSchema,
  expectedVersion: z.number().int().positive().optional(),
});
export type DecideDecisionInput = z.infer<typeof decideDecisionInputSchema>;

export const decisionListSchema = z.object({
  items: z.array(decisionSchema),
});
export type DecisionList = z.infer<typeof decisionListSchema>;

export const listDecisionsQuerySchema = z.object({
  status: decisionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;
