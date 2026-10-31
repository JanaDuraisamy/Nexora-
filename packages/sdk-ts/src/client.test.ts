import { describe, expect, it, vi } from "vitest";
import { NexoraApiError, NexoraClient } from "./index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("NexoraClient", () => {
  it("calls the health endpoint with the service token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        service: "nexora-core",
        version: "0.1.0",
        uptimeSeconds: 1.5,
        timestamp: "2026-10-31T10:00:00.000Z",
      }),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      apiToken: "test-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const health = await client.health();

    expect(health.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4000/health");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-token",
    );
  });

  it("serializes list filters into the query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000/",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.tasks.list({ status: "ready", limit: 10 });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/v1/tasks");
    expect(url.searchParams.get("status")).toBe("ready");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("maps API error envelopes to NexoraApiError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "forbidden",
            message: "Identity lacks approval permission",
          },
        },
        403,
      ),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.decisions.get("00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({
      name: "NexoraApiError",
      statusCode: 403,
      code: "forbidden",
    });
  });

  it("returns the readiness body for a 503 degraded response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          status: "degraded",
          service: "nexora-core",
          version: "0.1.0",
          timestamp: "2026-10-31T10:00:00.000Z",
          checks: {
            database: {
              status: "not_configured",
              message: "DATABASE_URL is not set",
            },
          },
        },
        503,
      ),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const readiness = await client.readiness();

    expect(readiness.status).toBe("degraded");
    expect(readiness.checks.database.status).toBe("not_configured");
  });

  it("rejects responses that violate the contract", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "ok" }));

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.health()).rejects.toBeInstanceOf(NexoraApiError);
  });
});
