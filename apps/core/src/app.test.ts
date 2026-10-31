import {
  apiErrorSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from "@nexora/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { CredentialDirectory } from "./auth/credentials.js";
import type { AppConfig } from "./config.js";

const baseConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  logLevel: "silent",
  databaseUrl: null,
  databaseSsl: "disable",
  corsOrigins: ["http://localhost:5173"],
};

const TEST_TOKEN = "unit-test-credential-0000000001";
const ACTOR_ID = "00000000-0000-4000-8000-0000000000aa";

const directory: CredentialDirectory = {
  async resolve(token) {
    if (token !== TEST_TOKEN) {
      return null;
    }

    return {
      id: ACTOR_ID,
      handle: "ev",
      kind: "ai_agent",
      tier: "tier_a",
      credentialId: "00000000-0000-4000-8000-0000000000bb",
    };
  },
};

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function createApp(overrides: Partial<AppConfig> = {}) {
  const app = await buildApp({
    config: { ...baseConfig, ...overrides },
    credentialDirectory: directory,
  });
  apps.push(app);
  return app;
}

const authorized = { authorization: `Bearer ${TEST_TOKEN}` };

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

  it("keeps health endpoints public", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});

describe("API authentication", () => {
  it("rejects /v1 requests without a bearer token", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/v1/identities" });

    expect(response.statusCode).toBe(401);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects an unknown bearer token", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/identities",
      headers: { authorization: "Bearer wrong-credential-0000000000" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 for an unknown route once authenticated", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/missing",
      headers: authorized,
    });

    expect(response.statusCode).toBe(404);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("not_found");
  });

  it("reaches the route and reports the missing database as 503", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/identities",
      headers: authorized,
    });

    expect(response.statusCode).toBe(503);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("service_unavailable");
  });

  it("validates request bodies before touching the database", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: authorized,
      payload: { title: "" },
    });

    expect(response.statusCode).toBe(400);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error.code).toBe("bad_request");
  });
});
