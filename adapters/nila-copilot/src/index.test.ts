import { describe, expect, it, vi } from "vitest";
import { NexoraApiError } from "@nexora/sdk-ts";
import { NilaCopilotAdapter } from "./index.js";

const API_URL = "https://nexora.example.test";
const API_TOKEN = "nila-test-credential";
const IDENTITY_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function identity() {
  return {
    id: IDENTITY_ID,
    handle: "nila",
    displayName: "NILA",
    kind: "ai_agent",
    tier: "tier_b",
    status: "active",
    adapterKey: "nila-copilot",
    metadata: {},
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:00:00.000Z",
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: "Implement pull transport",
    description: null,
    status: "backlog",
    priority: "normal",
    createdBy: IDENTITY_ID,
    assigneeId: null,
    parentTaskId: null,
    dueAt: null,
    metadata: {},
    version: 1,
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:00:00.000Z",
    ...overrides,
  };
}

function adapter(fetchImpl: typeof fetch) {
  return new NilaCopilotAdapter({
    apiUrl: API_URL,
    apiToken: API_TOKEN,
    fetchImpl,
  });
}

function requestAt(
  fetchMock: ReturnType<typeof vi.fn>,
  index: number,
): [URL, RequestInit] {
  const [input, init] = fetchMock.mock.calls[index] as unknown as [
    URL,
    RequestInit,
  ];
  return [input, init];
}

describe("NilaCopilotAdapter", () => {
  it("requires a credential and sends it only as the per-identity bearer header", async () => {
    expect(
      () =>
        new NilaCopilotAdapter({
          apiUrl: API_URL,
          apiToken: "  ",
        }),
    ).toThrow(/per-identity API credential/i);

    const fetchMock = vi.fn(async () => jsonResponse(identity()));
    await adapter(fetchMock as unknown as typeof fetch).me();

    const [url, init] = requestAt(fetchMock, 0);
    expect(url.pathname).toBe("/v1/whoami");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${API_TOKEN}`,
    );
    expect(url.toString()).not.toContain(API_TOKEN);
  });

  it("rejects insecure non-loopback API URLs", () => {
    expect(
      () =>
        new NilaCopilotAdapter({
          apiUrl: "http://api.example.test",
          apiToken: API_TOKEN,
        }),
    ).toThrow(/require HTTPS/i);
  });

  it("lists tasks assigned to the authenticated NILA identity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(identity()))
      .mockResolvedValueOnce(jsonResponse({ items: [task({ assigneeId: IDENTITY_ID })] }));

    const result = await adapter(fetchMock as unknown as typeof fetch).listMyTasks();

    expect(result.items).toHaveLength(1);
    expect(requestAt(fetchMock, 0)[0].pathname).toBe("/v1/whoami");
    const [url, init] = requestAt(fetchMock, 1);
    expect(url.pathname).toBe("/v1/tasks");
    expect(url.searchParams.get("assigneeId")).toBe(IDENTITY_ID);
    expect(url.searchParams.get("limit")).toBe("50");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${API_TOKEN}`,
    );
  });

  it("retrieves a task by ID", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(task()));

    const result = await adapter(fetchMock as unknown as typeof fetch).getTask(
      TASK_ID,
    );

    expect(result.id).toBe(TASK_ID);
    expect(requestAt(fetchMock, 0)[0].pathname).toBe(`/v1/tasks/${TASK_ID}`);
  });

  it("claims a task with the expected version", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(task({ assigneeId: IDENTITY_ID, version: 2 })),
    );

    const result = await adapter(fetchMock as unknown as typeof fetch).claimTask(
      TASK_ID,
      1,
    );

    expect(result.assigneeId).toBe(IDENTITY_ID);
    const [url, init] = requestAt(fetchMock, 0);
    expect(url.pathname).toBe(`/v1/tasks/${TASK_ID}/claim`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 1 });
  });

  it("polls events with a resumable cursor and returns the next cursor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ items: [], nextSeq: 42 }),
    );

    const result = await adapter(
      fetchMock as unknown as typeof fetch,
    ).pollEvents(36, 20);

    expect(result).toEqual({ items: [], nextSeq: 42 });
    const [url] = requestAt(fetchMock, 0);
    expect(url.pathname).toBe("/v1/events");
    expect(url.searchParams.get("afterSeq")).toBe("36");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("surfaces API errors without disguising them", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "forbidden",
            message: "NILA lacks task:read",
          },
        },
        403,
      ),
    );

    await expect(
      adapter(fetchMock as unknown as typeof fetch).getTask(TASK_ID),
    ).rejects.toMatchObject<NexoraApiError>({
      name: "NexoraApiError",
      statusCode: 403,
      code: "forbidden",
      message: "NILA lacks task:read",
      details: undefined,
    });
  });

  it("allows explicit caller retry after a transient transport failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection interrupted"))
      .mockResolvedValueOnce(jsonResponse(task()));
    const nila = adapter(fetchMock as unknown as typeof fetch);

    await expect(nila.getTask(TASK_ID)).rejects.toMatchObject({
      code: "network_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retried = await nila.getTask(TASK_ID);
    expect(retried.id).toBe(TASK_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
