import {
  createIdentityInputSchema,
  identityListSchema,
  identitySchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DatabasePort } from "../db.js";
import { currentActor } from "../http/actor.js";
import {
  requireActiveIdentity,
  requirePermission,
} from "../http/authorization.js";
import { notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
import { appendEvent } from "../repositories/events.js";
import {
  createIdentity,
  findIdentityById,
  listIdentities,
} from "../repositories/identities.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const idParamsSchema = z.object({
  id: z.uuid(),
});

export interface IdentityRoutesOptions {
  db: DatabasePort;
}

export const identityRoutes: FastifyPluginAsync<IdentityRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/identities", async (request) => {
    currentActor(request);
    const query = parseInput(listQuerySchema, request.query);
    const items = await listIdentities(options.db, query.limit);
    return identityListSchema.parse({ items });
  });

  app.get("/identities/:id", async (request) => {
    currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);
    const identity = await findIdentityById(options.db, id);
    if (!identity) {
      throw notFound(`Identity ${id} was not found`);
    }

    return identitySchema.parse(identity);
  });

  /**
   * Creating an identity is an administrative act.
   *
   * The actor comes from the verified credential, and only an identity holding
   * `identity:admin` (or the owner tier) may proceed. The new row and its
   * `identity.created` event are written in one transaction, so history cannot
   * disagree with the table.
   */
  app.post("/identities", async (request, reply) => {
    const actor = currentActor(request);
    const input = parseInput(createIdentityInputSchema, request.body);

    const identity = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "identity", "admin");

      const created = await createIdentity(q, input);
      await appendEvent(q, {
        type: "identity.created",
        aggregateType: "identity",
        aggregateId: created.id,
        actorId: actor.id,
        payload: {
          handle: created.handle,
          displayName: created.displayName,
          kind: created.kind,
          tier: created.tier,
          status: created.status,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return created;
    });

    reply.code(201);
    return identitySchema.parse(identity);
  });
};
