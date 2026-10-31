import { describe, expect, it, vi } from "vitest";
import { NexoraApiError, NexoraClient } from "./index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("NexoraClient", () => {
  it("calls the health endpoint with the identity credential", async () => {
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

  it("sends an idempotency key when creating a task", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        title: "Task",
        description: null,
        status: "backlog",
        priority: "normal",
        createdBy: "00000000-0000-4000-8000-000000000002",
        assigneeId: null,
        parentTaskId: null,
        dueAt: null,
        metadata: {},
        version: 1,
        createdAt: "2026-10-31T10:00:00.000Z",
        updatedAt: "2026-10-31T10:00:00.000Z",
      }),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.tasks.create({ title: "Task" }, { idempotencyKey: "retry-0001" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("retry-0001");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Task" });
  });

  it("sends notes without an actor field", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        seq: 1,
        id: "00000000-0000-4000-8000-000000000020",
        type: "system.note",
        aggregateType: "system",
        aggregateId: null,
        actorId: "00000000-0000-4000-8000-000000000002",
        payload: { message: "hello", topic: null },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
        occurredAt: "2026-10-31T10:00:00.000Z",
        recordedAt: "2026-10-31T10:00:00.000Z",
      }),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.events.note({ message: "hello" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.actorId).toBeUndefined();
    expect(body.message).toBe("hello");
  });

  it("revokes a permission by id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "00000000-0000-4000-8000-000000000030",
        identityId: "00000000-0000-4000-8000-000000000002",
        resourceType: "task",
        resourceId: null,
        action: "write",
        grantedBy: "00000000-0000-4000-8000-000000000001",
        grantedAt: "2026-10-31T10:00:00.000Z",
        expiresAt: null,
        revokedAt: "2026-10-31T11:00:00.000Z",
        revokedBy: "00000000-0000-4000-8000-000000000001",
      }),
    );

    const client = new NexoraClient({
      baseUrl: "http://127.0.0.1:4000",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.permissions.revoke("00000000-0000-4000-8000-000000000030");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(
      "/v1/permissions/00000000-0000-4000-8000-000000000030/revoke",
    );
    expect(init.method).toBe("POST");
  });
});
