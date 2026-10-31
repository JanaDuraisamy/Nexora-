import { healthResponseSchema, readinessResponseSchema } from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { DatabasePort } from "../db.js";
import { SERVICE_NAME, SERVICE_VERSION } from "../version.js";

export interface HealthRoutesOptions {
  db: DatabasePort;
  startedAt: number;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/health", async () =>
    healthResponseSchema.parse({
      status: "ok",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: (Date.now() - options.startedAt) / 1000,
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/health/ready", async (request, reply) => {
    const timestamp = new Date().toISOString();

    if (!options.db.configured) {
      reply.code(503);
      return readinessResponseSchema.parse({
        status: "degraded",
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp,
        checks: {
          database: {
            status: "not_configured",
            message: "DATABASE_URL is not set",
          },
        },
      });
    }

    try {
      const latencyMs = await options.db.ping();
      return readinessResponseSchema.parse({
        status: "ok",
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp,
        checks: {
          database: {
            status: "ok",
            latencyMs: Math.round(latencyMs * 100) / 100,
          },
        },
      });
    } catch (error) {
      request.log.error({ err: error }, "database readiness check failed");
      reply.code(503);
      return readinessResponseSchema.parse({
        status: "degraded",
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        timestamp,
        checks: {
          database: {
            status: "error",
            message: "Database connectivity check failed",
          },
        },
      });
    }
  });
};
