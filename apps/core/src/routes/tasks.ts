import {
  canTransitionTaskStatus,
  createTaskInputSchema,
  listTasksQuerySchema,
  taskListSchema,
  taskSchema,
  updateTaskStatusInputSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "../db.js";
import { requireActiveIdentity, requirePermission } from "../http/authorization.js";
import { conflict, notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
import { appendEvent } from "../repositories/events.js";
import {
  findTaskById,
  insertTask,
  listTasks,
  updateTaskStatus,
} from "../repositories/tasks.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface TaskRoutesOptions {
  db: Database;
}

export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/tasks", async (request, reply) => {
    const input = parseInput(createTaskInputSchema, request.body);

    const task = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, input.createdBy);
      await requirePermission(q, input.createdBy, "task", "write");

      if (input.assigneeId !== null) {
        await requireActiveIdentity(q, input.assigneeId);
      }

      const created = await insertTask(q, input);
      await appendEvent(q, {
        type: "task.created",
        aggregateType: "task",
        aggregateId: created.id,
        actorId: input.createdBy,
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

      return created;
    });

    reply.code(201);
    return taskSchema.parse(task);
  });

  app.get("/tasks", async (request) => {
    const query = parseInput(listTasksQuerySchema, request.query);
    const items = await listTasks(options.db, query);
    return taskListSchema.parse({ items });
  });

  app.get("/tasks/:id", async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const task = await findTaskById(options.db, id);
    if (!task) {
      throw notFound(`Task ${id} was not found`);
    }

    return taskSchema.parse(task);
  });

  app.post("/tasks/:id/status", async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(updateTaskStatusInputSchema, request.body);

    const task = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, input.actorId);
      await requirePermission(q, input.actorId, "task", "write", id);

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
        actorId: input.actorId,
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
};
