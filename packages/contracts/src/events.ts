import { z } from "zod";
import {
  identifierSchema,
  isoDateTimeSchema,
  metadataSchema,
} from "./primitives.js";

/**
 * Known event types for contract schema version 1.
 *
 * Adding a type is a contract change: bump EVENT_SCHEMA_VERSION, update the
 * database check constraint/migration, and document it in docs/specs.
 */
export const EVENT_TYPES = [
  "identity.created",
  "identity.updated",
  "task.created",
  "task.updated",
  "task.assigned",
  "task.status_changed",
  "decision.proposed",
  "decision.decided",
  "decision.superseded",
  "permission.granted",
  "permission.revoked",
  "system.note",
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export const AGGREGATE_TYPES = [
  "identity",
  "task",
  "decision",
  "permission",
  "system",
] as const;
export const aggregateTypeSchema = z.enum(AGGREGATE_TYPES);
export type AggregateType = z.infer<typeof aggregateTypeSchema>;

export const EVENT_VISIBILITIES = ["internal", "public"] as const;
export const eventVisibilitySchema = z.enum(EVENT_VISIBILITIES);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

export const EVENT_SCHEMA_VERSION = 1;

/**
 * Durable, append-only event envelope. `seq` is assigned by PostgreSQL and is
 * the authoritative global ordering of the log.
 */
export const eventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  id: identifierSchema,
  type: eventTypeSchema,
  aggregateType: aggregateTypeSchema,
  aggregateId: identifierSchema.nullable(),
  actorId: identifierSchema.nullable(),
  payload: metadataSchema,
  correlationId: identifierSchema.nullable(),
  causationId: identifierSchema.nullable(),
  schemaVersion: z.number().int().positive(),
  visibility: eventVisibilitySchema,
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const appendEventInputSchema = z.strictObject({
  type: eventTypeSchema,
  aggregateType: aggregateTypeSchema,
  aggregateId: identifierSchema.nullable().default(null),
  actorId: identifierSchema,
  payload: metadataSchema.default({}),
  correlationId: identifierSchema.nullable().default(null),
  causationId: identifierSchema.nullable().default(null),
  schemaVersion: z.number().int().positive().default(EVENT_SCHEMA_VERSION),
  visibility: eventVisibilitySchema.default("internal"),
  occurredAt: isoDateTimeSchema.optional(),
});
export type AppendEventInput = z.infer<typeof appendEventInputSchema>;

export const eventListSchema = z.object({
  items: z.array(eventEnvelopeSchema),
  nextSeq: z.number().int().nonnegative().nullable(),
});
export type EventList = z.infer<typeof eventListSchema>;

export const listEventsQuerySchema = z.object({
  aggregateType: aggregateTypeSchema.optional(),
  aggregateId: identifierSchema.optional(),
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
