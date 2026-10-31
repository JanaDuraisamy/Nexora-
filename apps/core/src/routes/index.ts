import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.js";
import { decisionRoutes } from "./decisions.js";
import { eventRoutes } from "./events.js";
import { identityRoutes } from "./identities.js";
import { permissionRoutes } from "./permissions.js";
import { taskRoutes } from "./tasks.js";

export interface V1RoutesOptions {
  db: Database;
}

export const v1Routes: FastifyPluginAsync<V1RoutesOptions> = async (
  app,
  options,
) => {
  await app.register(
    async (scope) => {
      await scope.register(identityRoutes, { db: options.db });
      await scope.register(eventRoutes, { db: options.db });
      await scope.register(taskRoutes, { db: options.db });
      await scope.register(decisionRoutes, { db: options.db });
      await scope.register(permissionRoutes, { db: options.db });
    },
    { prefix: "/v1" },
  );
};
