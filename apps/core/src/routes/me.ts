import { identitySchema } from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { DatabasePort } from "../db.js";
import { currentActor } from "../http/actor.js";
import { notFound } from "../http/errors.js";
import { findIdentityById } from "../repositories/identities.js";

export interface MeRoutesOptions {
  db: DatabasePort;
}

/**
 * Identity introspection for adapters.
 *
 * An adapter can read the identity bound to its credential instead of being
 * configured with a UUID, which removes one way for an integration to act as
 * the wrong participant.
 */
export const meRoutes: FastifyPluginAsync<MeRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/whoami", async (request) => {
    const actor = currentActor(request);
    const identity = await findIdentityById(options.db, actor.id);
    if (!identity) {
      throw notFound("The authenticated identity no longer exists");
    }

    return identitySchema.parse(identity);
  });
};
