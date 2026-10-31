import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  DatabaseCredentialDirectory,
  type CredentialDirectory,
} from "./auth/credentials.js";
import type { AppConfig } from "./config.js";
import {
  Database,
  DatabaseNotConfiguredError,
  type DatabasePort,
} from "./db.js";
import { createAuthHook } from "./http/auth.js";
import { ApiError } from "./http/errors.js";
import { healthRoutes } from "./routes/health.js";
import { v1Routes } from "./routes/index.js";

export interface BuildAppOptions {
  config: AppConfig;
  /** Injectable database, used by tests to avoid real connections. */
  db?: DatabasePort;
  /** Injectable credential store, used by unit tests without a database. */
  credentialDirectory?: CredentialDirectory;
}

interface PgError {
  code: string;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const db =
    options.db ??
    new Database(
      config.databaseUrl === null
        ? null
        : {
            connectionString: config.databaseUrl,
            ssl: config.databaseSsl,
          },
    );

  const app = Fastify({
    logger: buildLoggerOptions(config),
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  // Set by the auth hook for every /v1 request that resolves to an identity.
  app.decorateRequest("actor", null);

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  app.addHook("onRequest", createAuthHook(
    options.credentialDirectory ?? new DatabaseCredentialDirectory(db),
    config,
  ));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, "request failed");
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    if (error instanceof DatabaseNotConfiguredError) {
      return reply.code(503).send({
        error: {
          code: "service_unavailable",
          message: "The database is not configured for this environment",
          requestId: request.id,
        },
      });
    }

    if (isPgError(error)) {
      const mapped = mapPgError(error.code);
      if (mapped.statusCode >= 500) {
        request.log.error({ err: error }, "database error");
      }
      return reply.code(mapped.statusCode).send({
        error: {
          code: mapped.code,
          message: mapped.message,
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, "unhandled request error");
    return reply.code(500).send({
      error: {
        code: "internal_error",
        message: "Unexpected server error",
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "not_found",
        message: `Route ${request.method} ${request.url} was not found`,
        requestId: request.id,
      },
    }),
  );

  await app.register(healthRoutes, { db, startedAt: Date.now() });
  await app.register(v1Routes, { db });

  app.addHook("onClose", async () => {
    if (!options.db) {
      await db.close();
    }
  });

  return app;
}

function buildLoggerOptions(
  config: AppConfig,
): FastifyServerOptions["logger"] {
  if (config.nodeEnv === "test") {
    return false;
  }

  if (config.nodeEnv === "development") {
    return {
      level: config.logLevel,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    };
  }

  return { level: config.logLevel };
}

function isPgError(error: unknown): error is PgError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function mapPgError(code: string): {
  statusCode: number;
  code: "bad_request" | "conflict" | "internal_error";
  message: string;
} {
  switch (code) {
    case "23505":
      return {
        statusCode: 409,
        code: "conflict",
        message: "A record with the same unique values already exists",
      };
    case "23503":
      return {
        statusCode: 409,
        code: "conflict",
        message: "A referenced record does not exist",
      };
    case "23514":
      return {
        statusCode: 400,
        code: "bad_request",
        message: "A database constraint rejected the request",
      };
    case "22P02":
      return {
        statusCode: 400,
        code: "bad_request",
        message: "A value had an invalid format",
      };
    default:
      return {
        statusCode: 500,
        code: "internal_error",
        message: "Database operation failed",
      };
  }
}
