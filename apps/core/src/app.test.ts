import {
  apiErrorSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from "@nexora/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";

const baseConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  logLevel: "silent",
  databaseUrl: null,
  databaseSsl: "disable",
  corsOrigins: ["http://localhost:5173"],
  apiToken: null,
};

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function createApp(overrides: Partial<AppConfig> = {}) {
  const app = await buildApp({
    config: { ...baseConfig, ...overrides },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("core health routes", () => {
  it("returns a contract-valid liveness response", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.service).toBe("nexora-core");
    expect(body.status).toBe("ok");
  });

  it("reports degraded readiness when the database is not configured", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    const body = readinessResponseSchema.parse(response.json());
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("not_configured");
  });
});

describe("core API plumbing", () => {
  it("returns a structured error envelope for unknown routes", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(response.statusCode).toBe(404);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("not_found");
  });

  it("rejects /v1 requests without a bearer token when configured", async () => {
    const app = await createApp({ apiToken: "test-token-that-is-long-enough" });
    const response = await app.inject({ method: "GET", url: "/v1/identities" });

    expect(response.statusCode).toBe(401);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("unauthorized");
  });

  it("accepts the bearer token and reaches the route", async () => {
    const app = await createApp({ apiToken: "test-token-that-is-long-enough" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/identities",
      headers: { authorization: "Bearer test-token-that-is-long-enough" },
    });

    // The route is wired, but no database is configured in unit tests.
    expect(response.statusCode).toBe(503);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("service_unavailable");
  });

  it("validates request bodies before touching the database", async () => {
    const app = await createApp({ apiToken: "test-token-that-is-long-enough" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: "Bearer test-token-that-is-long-enough" },
      payload: { title: "" },
    });

    expect(response.statusCode).toBe(400);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("bad_request");
  });
});
