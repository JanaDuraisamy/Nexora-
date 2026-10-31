import {
  assignTaskInputSchema,
  canTransitionTaskStatus,
  claimTaskInputSchema,
  createTaskInputSchema,
  idempotencyKeySchema,
  listTasksQuerySchema,
  taskListSchema,
  taskSchema,
  type Task,
  updateTaskStatusInputSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DatabasePort, Queryable } from "../db.js";
import { currentActor } from "../http/actor.js";
import type { AuthenticatedActor } from "../http/actor.js";
import {
  requireActiveIdentity,
  requirePermission,
} from "../http/authorization.js";
import { badRequest, conflict, notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
import { appendEvent } from "../repositories/events.js";
import {
  attachIdempotencyResource,
  hashIdempotencyPayload,
  reserveIdempotencyKey,
} from "../repositories/idempotency.js";
import {
  assignTask,
  findTaskById,
  insertTask,
  listTasks,
  updateTaskStatus,
} from "../repositories/tasks.js";

const idParamsSchema = z.object({ id: z.uuid() });

const CREATE_TASK_SCOPE = "tasks.create";

export interface TaskRoutesOptions {
  db: DatabasePort;
}

export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  app,
  options,
) => {
  /**
   * Create a task, optionally idempotently.
   *
   * The creator is the authenticated identity. When an `Idempotency-Key` header
   * is present, the key, the task and the `task.created` event commit together,
   * so a retried request returns the original task instead of a duplicate.
   */
  app.post("/tasks", async (request, reply) => {
    const actor = currentActor(request);
    const input = parseInput(createTaskInputSchema, request.body);
    const idempotencyKey = readIdempotencyKey(request);
    const payloadHash = hashIdempotencyPayload(input);

    const result = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "task", "write");

      if (input.assigneeId !== null) {
        await requireActiveIdentity(q, input.assigneeId);
      }

      if (idempotencyKey !== null) {
        const reservation = await reserveIdempotencyKey(q, {
          identityId: actor.id,
          scope: CREATE_TASK_SCOPE,
          key: idempotencyKey,
          resourceType: "task",
          payloadHash,
        });

        if (reservation.replayed) {
          if (reservation.payloadHash !== payloadHash) {
            throw conflict(
              "Idempotency key was already used with a different task payload",
            );
          }

          if (reservation.resourceId === null) {
            throw conflict(
              "A request with this idempotency key is still in progress",
            );
          }

          const existing = await findTaskById(q, reservation.resourceId);
          if (!existing) {
            throw conflict(
              "The idempotency key refers to a task that no longer exists",
            );
          }

          return { task: existing, replayed: true };
        }
      }

      const created = await insertTask(q, input, actor.id);

      if (idempotencyKey !== null) {
        await attachIdempotencyResource(
          q,
          {
            identityId: actor.id,
            scope: CREATE_TASK_SCOPE,
            key: idempotencyKey,
            resourceType: "task",
            payloadHash,
          },
          created.id,
        );
      }

      await appendEvent(q, {
        type: "task.created",
        aggregateType: "task",
        aggregateId: created.id,
        actorId: actor.id,
        payload: {
          title: created.title,
          status: created.status,
          priority: created.priority,
          assigneeId: created.assigneeId,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return { task: created, replayed: false };
    });

    reply.code(result.replayed ? 200 : 201);
    if (result.replayed) {
      reply.header("idempotency-replayed", "true");
    }

    return taskSchema.parse(result.task);
  });

  app.get("/tasks", async (request) => {
    const actor = currentActor(request);
    const query = parseInput(listTasksQuerySchema, request.query);

    await requirePermission(options.db, actor.id, "task", "read");
    const items = await listTasks(options.db, query);
    return taskListSchema.parse({ items });
  });

  app.get("/tasks/:id", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);

    await requirePermission(options.db, actor.id, "task", "read", id);
    const task = await findTaskById(options.db, id);
    if (!task) {
      throw notFound(`Task ${id} was not found`);
    }

    return taskSchema.parse(task);
  });

  app.post("/tasks/:id/status", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(updateTaskStatusInputSchema, request.body);

    const task = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "task", "write", id);

      const current = await findTaskById(q, id);
      if (!current) {
        throw notFound(`Task ${id} was not found`);
      }

      if (current.version !== input.expectedVersion) {
        throw conflict("Task version mismatch", {
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }

      if (!canTransitionTaskStatus(current.status, input.status)) {
        throw conflict(
          `Illegal task transition from '${current.status}' to '${input.status}'`,
          { from: current.status, to: input.status },
        );
      }

      const updated = await updateTaskStatus(
        q,
        id,
        input.status,
        input.expectedVersion,
      );
      if (!updated) {
        throw conflict("Task was modified concurrently; reload and retry");
      }

      await appendEvent(q, {
        type: "task.status_changed",
        aggregateType: "task",
        aggregateId: id,
        actorId: actor.id,
        payload: {
          from: current.status,
          to: updated.status,
          version: updated.version,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return updated;
    });

    return taskSchema.parse(task);
  });

  /**
   * Assign or release a task. `assigneeId: null` releases it.
   *
   * The update is a single conditional statement on `(id, version)`, so two
   * concurrent writers cannot both succeed.
   */
  app.post("/tasks/:id/assign", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(assignTaskInputSchema, request.body);

    const task = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "task", "write", id);

      if (input.assigneeId !== null) {
        await requireActiveIdentity(q, input.assigneeId);
      }

      return applyAssignment(q, {
        actor,
        taskId: id,
        assigneeId: input.assigneeId,
        expectedVersion: input.expectedVersion,
        requireUnassigned: false,
      });
    });

    return taskSchema.parse(task);
  });

  /**
   * Claim an unassigned task for the authenticated identity.
   *
   * Claiming requires `task:write` on the task. The conditional update includes
   * `assignee_id is null`, so exactly one of several concurrent claims wins.
   */
  app.post("/tasks/:id/claim", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(claimTaskInputSchema, request.body);

    const task = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "task", "write", id);

      return applyAssignment(q, {
        actor,
        taskId: id,
        assigneeId: actor.id,
        expectedVersion: input.expectedVersion,
        requireUnassigned: true,
      });
    });

    return taskSchema.parse(task);
  });
};

interface AssignmentContext {
  actor: AuthenticatedActor;
  taskId: string;
  assigneeId: string | null;
  expectedVersion: number;
  requireUnassigned: boolean;
}

async function applyAssignment(
  q: Queryable,
  context: AssignmentContext,
): Promise<Task> {
  const current = await findTaskById(q, context.taskId);
  if (!current) {
    throw notFound(`Task ${context.taskId} was not found`);
  }

  if (current.version !== context.expectedVersion) {
    throw conflict("Task version mismatch", {
      expectedVersion: context.expectedVersion,
      actualVersion: current.version,
    });
  }

  if (current.assigneeId === context.assigneeId) {
    // No-op: keep the version stable and do not emit a misleading event.
    return current;
  }

  if (context.requireUnassigned && current.assigneeId !== null) {
    throw conflict("Task is already assigned", {
      assigneeId: current.assigneeId,
    });
  }

  const updated = await assignTask(
    q,
    context.taskId,
    context.assigneeId,
    context.expectedVersion,
    { requireUnassigned: context.requireUnassigned },
  );

  if (!updated) {
    throw conflict("Task was modified concurrently; reload and retry");
  }

  await appendEvent(q, {
    type: "task.assigned",
    aggregateType: "task",
    aggregateId: context.taskId,
    actorId: context.actor.id,
    payload: {
      from: current.assigneeId,
      to: updated.assigneeId,
      version: updated.version,
    },
    correlationId: null,
    causationId: null,
    schemaVersion: 1,
    visibility: "internal",
  });

  return updated;
}

function readIdempotencyKey(request: FastifyRequest): string | null {
  const header = request.headers["idempotency-key"];
  const raw = Array.isArray(header) ? header[0] : header;

  if (raw === undefined) {
    return null;
  }

  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      "Invalid Idempotency-Key header",
      parsed.error.issues.map((issue) => ({
        path: "idempotency-key",
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  return parsed.data;
}
