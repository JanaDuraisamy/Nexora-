import {
  createIdentityInputSchema,
  identityListSchema,
  identitySchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "../db.js";
import { notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
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
  db: Database;
}

export const identityRoutes: FastifyPluginAsync<IdentityRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/identities", async (request) => {
    const query = parseInput(listQuerySchema, request.query);
    const items = await listIdentities(options.db, query.limit);
    return identityListSchema.parse({ items });
  });

  app.get("/identities/:id", async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const identity = await findIdentityById(options.db, id);
    if (!identity) {
      throw notFound(`Identity ${id} was not found`);
    }

    return identitySchema.parse(identity);
  });

  app.post("/identities", async (request, reply) => {
    const input = parseInput(createIdentityInputSchema, request.body);
    const identity = await createIdentity(options.db, input);
    reply.code(201);
    return identitySchema.parse(identity);
  });
};
