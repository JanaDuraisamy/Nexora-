import {
  appendNoteInputSchema,
  eventEnvelopeSchema,
  eventListSchema,
  listEventsQuerySchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { DatabasePort } from "../db.js";
import { currentActor } from "../http/actor.js";
import {
  requireActiveIdentity,
  requirePermission,
} from "../http/authorization.js";
import { parseInput } from "../http/validation.js";
import { appendEvent, listEvents } from "../repositories/events.js";

export interface EventRoutesOptions {
  db: DatabasePort;
}

/**
 * Standalone event submission is limited to non-domain notes.
 *
 * Domain events (`task.created`, `decision.decided`, `permission.granted`, ...)
 * are emitted only by the Core methods that own the corresponding aggregate,
 * inside the same transaction that mutates it. Exposing them here let any
 * event-writer forge history that no table state backed.
 */
export const eventRoutes: FastifyPluginAsync<EventRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/events", async (request, reply) => {
    const actor = currentActor(request);
    const input = parseInput(appendNoteInputSchema, request.body);

    const event = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "event", "write");

      return appendEvent(q, {
        type: "system.note",
        aggregateType: "system",
        aggregateId: null,
        actorId: actor.id,
        payload: {
          ...input.metadata,
          message: input.message,
          topic: input.topic,
        },
        correlationId: input.correlationId,
        causationId: input.causationId,
        schemaVersion: 1,
        visibility: input.visibility,
      });
    });

    reply.code(201);
    return eventEnvelopeSchema.parse(event);
  });

  app.get("/events", async (request) => {
    const actor = currentActor(request);
    const query = parseInput(listEventsQuerySchema, request.query);

    await requirePermission(options.db, actor.id, "event", "read");
    const result = await listEvents(options.db, query);
    return eventListSchema.parse(result);
  });
};
