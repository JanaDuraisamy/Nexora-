import {
  appendEventInputSchema,
  eventEnvelopeSchema,
  eventListSchema,
  listEventsQuerySchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.js";
import { requireActiveIdentity, requirePermission } from "../http/authorization.js";
import { parseInput } from "../http/validation.js";
import { appendEvent, listEvents } from "../repositories/events.js";

export interface EventRoutesOptions {
  db: Database;
}

export const eventRoutes: FastifyPluginAsync<EventRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/events", async (request, reply) => {
    const input = parseInput(appendEventInputSchema, request.body);

    const event = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, input.actorId);
      await requirePermission(q, input.actorId, "event", "write");
      return appendEvent(q, input);
    });

    reply.code(201);
    return eventEnvelopeSchema.parse(event);
  });

  app.get("/events", async (request) => {
    const query = parseInput(listEventsQuerySchema, request.query);
    const result = await listEvents(options.db, query);
    return eventListSchema.parse(result);
  });
};
