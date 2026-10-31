import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { hashToken } from "./auth/credentials.js";
import type { AppConfig } from "./config.js";
import { createCredential } from "./repositories/credentials.js";
import { createTestDatabase, type TestDatabase } from "./testing/pglite.js";

const CONFIG: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  logLevel: "silent",
  databaseUrl: null,
  databaseSsl: "disable",
  corsOrigins: ["http://localhost:5173"],
};

const TOKENS = {
  jana: "jana-test-credential-000000000001",
  ev: "ev-test-credential-00000000000002",
  nila: "nila-test-credential-000000000003",
  elio: "elio-test-credential-000000000004",
} as const;

type Handle = keyof typeof TOKENS;

const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

let db: TestDatabase;
let app: FastifyInstance;
let ids: Record<Handle, string>;

beforeEach(async () => {
  db = await createTestDatabase();

  const rows = await db.query<{ handle: Handle; id: string }>(
    "select handle, id from nexora.identities",
  );
  ids = Object.fromEntries(rows.map((row) => [row.handle, row.id])) as Record<
    Handle,
    string
  >;

  for (const handle of Object.keys(TOKENS) as Handle[]) {
    await createCredential(db, {
      identityId: ids[handle],
      tokenHash: hashToken(TOKENS[handle]),
      label: `${handle}-test`,
      createdBy: ids.jana,
      expiresAt: null,
    });
  }

  app = await buildApp({ config: CONFIG, db });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

function auth(handle: Handle): Record<string, string> {
  return { authorization: `Bearer ${TOKENS[handle]}` };
}

async function countEvents(type?: string): Promise<number> {
  const rows = await db.query<{ count: number }>(
    type === undefined
      ? "select count(*)::int as count from nexora.events"
      : "select count(*)::int as count from nexora.events where type = $1",
    type === undefined ? [] : [type],
  );
  return rows[0]?.count ?? -1;
}

async function createTaskAs(handle: Handle, body: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: auth(handle),
    payload: { title: `task for ${handle}`, ...body },
  });
  return response;
}

describe("credential authentication", () => {
  it("rejects a request with no bearer token", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/whoami" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
  });

  it("rejects an unknown bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: { authorization: "Bearer not-a-real-credential-000" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a revoked credential", async () => {
    await db.query(
      `update nexora.identity_credentials
          set revoked_at = now(), revoked_by = $2
        where token_hash = $1`,
      [hashToken(TOKENS.ev), ids.jana],
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: auth("ev"),
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an expired credential", async () => {
    const token = "expired-credential-00000000000005";
    await db.query(
      `insert into nexora.identity_credentials
         (identity_id, token_hash, label, created_at, expires_at)
       values ($1, $2, 'expired', now() - interval '2 days', now() - interval '1 day')`,
      [ids.ev, hashToken(token)],
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("resolves the authenticated identity", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: auth("nila"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: ids.nila, handle: "nila" });
  });
});

describe("NILA Tier B permissions and capabilities", () => {
  it("keeps EV Tier A and gives NILA the pull-only task/event grants", async () => {
    const identities = await db.query<{ handle: string; tier: string }>(
      "select handle, tier from nexora.identities where handle in ('ev', 'nila')",
    );
    expect(identities).toEqual(
      expect.arrayContaining([
        { handle: "ev", tier: "tier_a" },
        { handle: "nila", tier: "tier_b" },
      ]),
    );

    const nilaPermissions = await db.query<{
      resource_type: string;
      action: string;
    }>(
      `select resource_type, action
         from nexora.permissions
        where identity_id = $1
          and (resource_type, action) in (
            ('task', 'read'),
            ('task', 'write'),
            ('event', 'read')
          )`,
      [ids.nila],
    );
    expect(nilaPermissions).toHaveLength(3);

    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;
    const claimed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/claim`,
      headers: auth("nila"),
      payload: { expectedVersion: 1 },
    });
    const tasks = await app.inject({
      method: "GET",
      url: "/v1/tasks?limit=20",
      headers: auth("nila"),
    });
    const events = await app.inject({
      method: "GET",
      url: "/v1/events?afterSeq=0&limit=20",
      headers: auth("nila"),
    });

    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().assigneeId).toBe(ids.nila);
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().items.map((item: { id: string }) => item.id)).toContain(
      taskId,
    );
    expect(events.statusCode).toBe(200);
    expect(events.json().items.length).toBeGreaterThan(0);
  });
});

describe("actor impersonation (finding 2)", () => {
  it("stamps the credential identity as task creator and rejects a body actor", async () => {
    const created = await createTaskAs("ev", { createdBy: ids.jana });
    expect(created.statusCode).toBe(400);

    const valid = await createTaskAs("ev");
    expect(valid.statusCode).toBe(201);
    expect(valid.json().createdBy).toBe(ids.ev);

    const events = await db.query<{ actor_id: string }>(
      "select actor_id from nexora.events where type = 'task.created'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe(ids.ev);
  });

  it("rejects actor fields on events, status changes and decisions", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const attempts = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/events",
        headers: auth("ev"),
        payload: { type: "system.note", aggregateType: "system", actorId: ids.jana },
      }),
      app.inject({
        method: "POST",
        url: `/v1/tasks/${taskId}/status`,
        headers: auth("ev"),
        payload: { status: "ready", expectedVersion: 1, actorId: ids.jana },
      }),
      app.inject({
        method: "POST",
        url: "/v1/decisions",
        headers: auth("ev"),
        payload: { title: "t", context: "c", proposedBy: ids.jana },
      }),
      app.inject({
        method: "POST",
        url: "/v1/decisions/00000000-0000-4000-8000-000000000000/decide",
        headers: auth("jana"),
        payload: { status: "approved", rationale: "r", decidedBy: ids.jana },
      }),
    ]);

    for (const response of attempts) {
      expect(response.statusCode).toBe(400);
    }
  });

  it("records the acting identity on task status events", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const response = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/status`,
      headers: auth("nila"),
      payload: { status: "ready", expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(200);

    const events = await db.query<{ actor_id: string }>(
      "select actor_id from nexora.events where type = 'task.status_changed'",
    );
    expect(events[0]?.actor_id).toBe(ids.nila);
  });
});

describe("identity administration (finding 1)", () => {
  it("forbids identity creation without identity:admin", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/identities",
      headers: auth("ev"),
      payload: {
        handle: "rogue",
        displayName: "Rogue",
        kind: "ai_agent",
        tier: "tier_b",
      },
    });

    expect(response.statusCode).toBe(403);
    const rows = await db.query("select 1 from nexora.identities where handle = 'rogue'");
    expect(rows).toHaveLength(0);
  });

  it("allows the owner and records the event atomically", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/identities",
      headers: auth("jana"),
      payload: {
        handle: "ops-bot",
        displayName: "Ops Bot",
        kind: "ai_agent",
        tier: "tier_b",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().handle).toBe("ops-bot");

    const events = await db.query<{ actor_id: string; aggregate_type: string }>(
      "select actor_id, aggregate_type from nexora.events where type = 'identity.created'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor_id: ids.jana,
      aggregate_type: "identity",
    });
  });
});

describe("standalone events (finding 3)", () => {
  it("refuses to forge a domain event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: auth("ev"),
      payload: {
        type: "task.created",
        aggregateType: "task",
        aggregateId: "00000000-0000-4000-8000-000000000000",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await countEvents()).toBe(0);
  });

  it("accepts a note and stamps the credential identity", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: auth("elio"),
      payload: { message: "Reviewed the payload", topic: "security" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      type: "system.note",
      aggregateType: "system",
      aggregateId: null,
      actorId: ids.elio,
    });
    expect(body.payload).toMatchObject({ message: "Reviewed the payload" });
  });
});

describe("direct database writes (finding 4)", () => {
  beforeEach(async () => {
    await createTaskAs("ev");
    await createTaskAs("ev");
  });

  it("denies authenticated INSERT on tasks", async () => {
    await expect(
      db.asRole("authenticated", () =>
        db.query(
          "insert into nexora.tasks (title, created_by) values ('forged', $1)",
          [ids.elio],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("denies authenticated UPDATE on tasks", async () => {
    await expect(
      db.asRole("authenticated", () =>
        db.query("update nexora.tasks set title = 'forged'"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("denies authenticated INSERT and UPDATE on decisions", async () => {
    await expect(
      db.asRole("authenticated", () =>
        db.query(
          "insert into nexora.decisions (title, context, proposed_by) values ('d', 'c', $1)",
          [ids.elio],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.asRole("authenticated", () =>
        db.query("update nexora.decisions set title = 'forged'"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("preserves read access for an identity with task:read", async () => {
    const authUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query(
      "update nexora.identities set auth_user_id = $2 where id = $1",
      [ids.elio, authUserId],
    );
    await db.setJwtSubject(authUserId);

    const rows = await db.asRole("authenticated", () =>
      db.query("select id from nexora.tasks"),
    );

    expect(rows.length).toBe(2);
  });
});

describe("task assignment (finding 5)", () => {
  it("claims a task atomically and emits task.assigned", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const claimed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/claim`,
      headers: auth("nila"),
      payload: { expectedVersion: 1 },
    });

    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({
      assigneeId: ids.nila,
      version: 2,
    });

    const events = await db.query<{ payload: Record<string, unknown> }>(
      "select payload from nexora.events where type = 'task.assigned'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      from: null,
      to: ids.nila,
      version: 2,
    });
  });

  it("rejects a second claim on the same task", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/claim`,
      headers: auth("nila"),
      payload: { expectedVersion: 1 },
    });

    const second = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/claim`,
      headers: auth("ev"),
      payload: { expectedVersion: 2 },
    });

    expect(second.statusCode).toBe(409);
    expect(await countEvents("task.assigned")).toBe(1);
  });

  it("reassigns and releases under version checks", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const assigned = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/assign`,
      headers: auth("ev"),
      payload: { assigneeId: ids.nila, expectedVersion: 1 },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ assigneeId: ids.nila, version: 2 });

    const released = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/assign`,
      headers: auth("ev"),
      payload: { assigneeId: null, expectedVersion: 2 },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json()).toMatchObject({ assigneeId: null, version: 3 });

    const stale = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/assign`,
      headers: auth("ev"),
      payload: { assigneeId: ids.nila, expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);

    expect(await countEvents("task.assigned")).toBe(2);
  });

  it("requires task:write to assign or claim", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const response = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/claim`,
      headers: auth("elio"),
      payload: { expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("task creation idempotency (finding 8)", () => {
  it("returns the original task for a repeated key", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "retry-key-000001" },
      payload: { title: "Once only" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "retry-key-000001" },
      payload: { title: "Once only" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json().id).toBe(first.json().id);

    const tasks = await db.query("select 1 from nexora.tasks");
    expect(tasks).toHaveLength(1);
    expect(await countEvents("task.created")).toBe(1);
  });

  it("scopes keys per identity", async () => {
    const headers = { "idempotency-key": "shared-key-000001" };

    const asNila = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), ...headers },
      payload: { title: "NILA task" },
    });
    const asEv = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("ev"), ...headers },
      payload: { title: "EV task" },
    });

    expect(asNila.statusCode).toBe(201);
    expect(asEv.statusCode).toBe(201);
    expect(asNila.json().id).not.toBe(asEv.json().id);
  });

  it("conflicts when a key is reused with a different payload", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "payload-key-0001" },
      payload: { title: "Original task" },
    });
    expect(first.statusCode).toBe(201);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "payload-key-0001" },
      payload: { title: "Different task" },
    });

    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.message).toMatch(/different task payload/i);
    expect(await db.query("select 1 from nexora.tasks")).toHaveLength(1);
    expect(await countEvents("task.created")).toBe(1);
  });

  it("treats object key order as the same payload", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "canonical-key-01" },
      payload: { title: "Canonical", metadata: { a: 1, b: 2 } },
    });
    const replay = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("nila"), "idempotency-key": "canonical-key-01" },
      payload: { metadata: { b: 2, a: 1 }, title: "Canonical" },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
  });

  it("creates one task and event for concurrent retries", async () => {
    const headers = {
      ...auth("nila"),
      "idempotency-key": "concurrent-key-01",
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/tasks",
          headers,
          payload: { title: "Concurrent retry" },
        }),
      ),
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect(new Set(responses.map((response) => response.json().id)).size).toBe(
      1,
    );
    expect(await db.query("select 1 from nexora.tasks")).toHaveLength(1);
    expect(await countEvents("task.created")).toBe(1);
  });

  it("rejects a malformed idempotency key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("ev"), "idempotency-key": "short" },
      payload: { title: "Task" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("aggregate and event transactionality", () => {
  it("rolls back task creation and its idempotency key when its event fails", async () => {
    await db.exec(`
      create function nexora.reject_task_created_test_event()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.type = 'task.created' then
          raise exception 'injected task.created failure';
        end if;
        return new;
      end;
      $$;
      create trigger reject_task_created_test_event
      before insert on nexora.events
      for each row execute function nexora.reject_task_created_test_event();
    `);

    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...auth("ev"), "idempotency-key": "rollback-key-0001" },
      payload: { title: "Must roll back" },
    });

    expect(response.statusCode).toBe(500);
    expect(await db.query("select 1 from nexora.tasks")).toHaveLength(0);
    expect(await countEvents("task.created")).toBe(0);
    expect(await db.query("select 1 from nexora.idempotency_keys")).toHaveLength(
      0,
    );
  });

  it("rolls back a task mutation when its domain event fails", async () => {
    const created = await createTaskAs("ev");
    const taskId = created.json().id as string;

    await db.exec(`
      create function nexora.reject_task_status_test_event()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.type = 'task.status_changed' then
          raise exception 'injected task.status_changed failure';
        end if;
        return new;
      end;
      $$;
      create trigger reject_task_status_test_event
      before insert on nexora.events
      for each row execute function nexora.reject_task_status_test_event();
    `);

    const response = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/status`,
      headers: auth("ev"),
      payload: { status: "ready", expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(500);
    const tasks = await db.query<{ status: string; version: number }>(
      "select status, version from nexora.tasks where id = $1",
      [taskId],
    );
    expect(tasks[0]).toEqual({ status: "backlog", version: 1 });
    expect(await countEvents("task.status_changed")).toBe(0);
  });
});

describe("permission administration (finding 12)", () => {
  it("forbids granting without permission:admin", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/permissions",
      headers: auth("ev"),
      payload: { identityId: ids.ev, resourceType: "task", action: "admin" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("grants, rejects duplicates and revokes with events", async () => {
    const granted = await app.inject({
      method: "POST",
      url: "/v1/permissions",
      headers: auth("jana"),
      payload: { identityId: ids.elio, resourceType: "task", action: "write" },
    });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({
      identityId: ids.elio,
      grantedBy: ids.jana,
      revokedAt: null,
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/permissions",
      headers: auth("jana"),
      payload: { identityId: ids.elio, resourceType: "task", action: "write" },
    });
    expect(duplicate.statusCode).toBe(409);

    const nowAllowed = await createTaskAs("elio");
    expect(nowAllowed.statusCode).toBe(201);

    const revoked = await app.inject({
      method: "POST",
      url: `/v1/permissions/${granted.json().id}/revoke`,
      headers: auth("jana"),
      payload: {},
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revokedBy).toBe(ids.jana);
    expect(revoked.json().revokedAt).not.toBeNull();

    const nowForbidden = await createTaskAs("elio");
    expect(nowForbidden.statusCode).toBe(403);

    expect(await countEvents("permission.granted")).toBe(1);
    expect(await countEvents("permission.revoked")).toBe(1);
  });

  it("allows a sentinel-UUID scope to coexist with a global grant (finding 13)", async () => {
    // `task:approve` is not seeded for NILA, so both inserts are genuinely new.
    const scoped = await app.inject({
      method: "POST",
      url: "/v1/permissions",
      headers: auth("jana"),
      payload: {
        identityId: ids.nila,
        resourceType: "task",
        resourceId: SENTINEL_UUID,
        action: "approve",
      },
    });
    expect(scoped.statusCode).toBe(201);

    const global = await app.inject({
      method: "POST",
      url: "/v1/permissions",
      headers: auth("jana"),
      payload: { identityId: ids.nila, resourceType: "task", action: "approve" },
    });
    expect(global.statusCode).toBe(201);

    const rows = await db.query(
      "select 1 from nexora.permissions where identity_id = $1 and action = 'approve'",
      [ids.nila],
    );
    expect(rows).toHaveLength(2);
  });

  it("hides other identities' grants from non-admins", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/permissions?identityId=${ids.elio}`,
      headers: auth("ev"),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("Supabase auth mapping (finding 6)", () => {
  it("maps auth_user_id to an identity and never accepts a raw identity id", async () => {
    const authUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query(
      "update nexora.identities set auth_user_id = $2 where id = $1",
      [ids.ev, authUserId],
    );

    await db.setJwtSubject(authUserId);
    const mapped = await db.query<{ actor: string | null }>(
      "select nexora.current_actor_id() as actor",
    );
    expect(mapped[0]?.actor).toBe(ids.ev);

    // The old implementation returned the raw `sub`; that must no longer work.
    await db.setJwtSubject(ids.ev);
    const raw = await db.query<{ actor: string | null }>(
      "select nexora.current_actor_id() as actor",
    );
    expect(raw[0]?.actor).toBeNull();
  });
});

describe("enum parameters (finding 10)", () => {
  it("filters tasks by enum value through the API", async () => {
    await createTaskAs("ev");

    const response = await app.inject({
      method: "GET",
      url: "/v1/tasks?status=backlog",
      headers: auth("ev"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });

  it("rejects an invalid enum value at the contract boundary", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/tasks?status=not_a_status",
      headers: auth("ev"),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("repository invariants", () => {
  it("enforces optimistic versions on assignment", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const { assignTask } = await import("./repositories/tasks.js");

    const result = await db.withTransaction((q) =>
      assignTask(q, taskId, ids.nila, 99, { requireUnassigned: false }),
    );

    expect(result).toBeNull();
  });

  it("keeps task transitions valid at the repository boundary", async () => {
    const task = await createTaskAs("ev");
    const taskId = task.json().id as string;

    const { findTaskById, updateTaskStatus } = await import(
      "./repositories/tasks.js"
    );

    const updated = await db.withTransaction(async (q) => {
      const current = await findTaskById(q, taskId);
      expect(current?.status).toBe("backlog");
      return updateTaskStatus(q, taskId, "ready", current?.version ?? 0);
    });

    expect(updated?.status).toBe("ready");
    expect(updated?.version).toBe(2);
  });
});
