import type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskStatus,
} from "@nexora/contracts";
import type { Queryable } from "../db.js";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  created_by: string;
  assignee_id: string | null;
  parent_task_id: string | null;
  due_at: Date | null;
  metadata: Record<string, unknown>;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, title, description, status, priority, created_by, assignee_id,
  parent_task_id, due_at, metadata, version, created_at, updated_at
`;

export interface TaskFilters {
  status?: TaskStatus;
  assigneeId?: string;
  limit: number;
}

export async function insertTask(
  q: Queryable,
  input: CreateTaskInput,
): Promise<Task> {
  const rows = await q.query<TaskRow>(
    `insert into nexora.tasks
       (title, description, priority, created_by, assignee_id, parent_task_id,
        due_at, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     returning ${COLUMNS}`,
    [
      input.title,
      input.description,
      input.priority,
      input.createdBy,
      input.assigneeId,
      input.parentTaskId,
      input.dueAt,
      JSON.stringify(input.metadata),
    ],
  );

  return requireTaskRow(rows, "Task insert returned no row");
}

export async function findTaskById(
  q: Queryable,
  id: string,
): Promise<Task | null> {
  const rows = await q.query<TaskRow>(
    `select ${COLUMNS} from nexora.tasks where id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? mapTask(row) : null;
}

export async function listTasks(
  q: Queryable,
  filters: TaskFilters,
): Promise<Task[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status !== undefined) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }

  if (filters.assigneeId !== undefined) {
    values.push(filters.assigneeId);
    conditions.push(`assignee_id = $${values.length}`);
  }

  values.push(filters.limit);
  const whereClause =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const rows = await q.query<TaskRow>(
    `select ${COLUMNS}
       from nexora.tasks
       ${whereClause}
      order by created_at desc
      limit $${values.length}`,
    values,
  );

  return rows.map(mapTask);
}

export async function updateTaskStatus(
  q: Queryable,
  id: string,
  status: TaskStatus,
  expectedVersion: number,
): Promise<Task | null> {
  const rows = await q.query<TaskRow>(
    `update nexora.tasks
        set status = $2,
            version = version + 1,
            updated_at = now()
      where id = $1
        and version = $3
      returning ${COLUMNS}`,
    [id, status, expectedVersion],
  );

  const row = rows[0];
  return row ? mapTask(row) : null;
}

function requireTaskRow(rows: TaskRow[], message: string): Task {
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }

  return mapTask(row);
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdBy: row.created_by,
    assigneeId: row.assignee_id,
    parentTaskId: row.parent_task_id,
    dueAt: row.due_at?.toISOString() ?? null,
    metadata: row.metadata,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
