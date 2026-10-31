import { z } from "zod";
import {
  identifierSchema,
  isoDateTimeSchema,
  metadataSchema,
  optionalText,
  requiredText,
} from "./primitives.js";

export const TASK_STATUSES = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** Allowed task transitions. Terminal statuses have no outgoing transitions. */
export const TASK_STATUS_TRANSITIONS: Readonly<
  Record<TaskStatus, readonly TaskStatus[]>
> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "review", "done", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  review: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus,
): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export const taskSchema = z.object({
  id: identifierSchema,
  title: requiredText(200),
  description: optionalText(5000).nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  createdBy: identifierSchema,
  assigneeId: identifierSchema.nullable(),
  parentTaskId: identifierSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  metadata: metadataSchema,
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

/**
 * Task creation input.
 *
 * `createdBy` is deliberately absent: the server derives the creator from the
 * verified credential. An idempotency key may be supplied in the
 * `Idempotency-Key` header; see `createTaskRequest`.
 */
export const createTaskInputSchema = z.strictObject({
  title: requiredText(200),
  description: optionalText(5000).nullable().default(null),
  priority: taskPrioritySchema.default("normal"),
  assigneeId: identifierSchema.nullable().default(null),
  parentTaskId: identifierSchema.nullable().default(null),
  dueAt: isoDateTimeSchema.nullable().default(null),
  metadata: metadataSchema.default({}),
});
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
/** Parsed task input with defaults applied; creator is added separately. */
export type CreateTaskData = z.output<typeof createTaskInputSchema>;

export const updateTaskStatusInputSchema = z.strictObject({
  status: taskStatusSchema,
  expectedVersion: z.number().int().positive(),
});
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusInputSchema>;

/** Reassign a task, or release it with `assigneeId: null`. */
export const assignTaskInputSchema = z.strictObject({
  assigneeId: identifierSchema.nullable(),
  expectedVersion: z.number().int().positive(),
});
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;

/** Claim an unassigned task for the authenticated identity. */
export const claimTaskInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export type ClaimTaskInput = z.infer<typeof claimTaskInputSchema>;

export const taskListSchema = z.object({
  items: z.array(taskSchema),
});
export type TaskList = z.infer<typeof taskListSchema>;

export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  assigneeId: identifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
