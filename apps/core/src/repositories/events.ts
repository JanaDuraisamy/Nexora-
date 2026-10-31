import type {
  AggregateType,
  EventEnvelope,
  EventType,
  EventVisibility,
} from "@nexora/contracts";
import type { Queryable } from "../db.js";

interface EventRow {
  seq: string;
  id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  causation_id: string | null;
  schema_version: number;
  visibility: EventVisibility;
  occurred_at: Date;
  recorded_at: Date;
}

const COLUMNS = `
  seq, id, type, aggregate_type, aggregate_id, actor_id, payload,
  correlation_id, causation_id, schema_version, visibility, occurred_at,
  recorded_at
`;

/**
 * Event written by Core business methods.
 *
 * `actorId` is always the authenticated identity supplied by the caller inside
 * the same transaction. There is no request-body path to this type.
 */
export interface EventDraft {
  type: EventType;
  aggregateType: AggregateType;
  aggregateId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  correlationId: string | null;
  causationId: string | null;
  schemaVersion: number;
  visibility: EventVisibility;
  occurredAt?: string | null;
}

export interface EventFilters {
  aggregateType?: string;
  aggregateId?: string;
  afterSeq?: number;
  limit: number;
}

export async function appendEvent(
  q: Queryable,
  input: EventDraft,
): Promise<EventEnvelope> {
  const rows = await q.query<EventRow>(
    `insert into nexora.events
       (type, aggregate_type, aggregate_id, actor_id, payload, correlation_id,
        causation_id, schema_version, visibility, occurred_at)
     values ($1, $2::nexora.aggregate_type, $3, $4, $5::jsonb, $6, $7, $8,
             $9::nexora.event_visibility, coalesce($10::timestamptz, now()))
     returning ${COLUMNS}`,
    [
      input.type,
      input.aggregateType,
      input.aggregateId,
      input.actorId,
      JSON.stringify(input.payload),
      input.correlationId,
      input.causationId,
      input.schemaVersion,
      input.visibility,
      input.occurredAt ?? null,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Event insert returned no row");
  }

  return mapEvent(row);
}

export async function listEvents(
  q: Queryable,
  filters: EventFilters,
): Promise<{ items: EventEnvelope[]; nextSeq: number | null }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.aggregateType !== undefined) {
    values.push(filters.aggregateType);
    conditions.push(`aggregate_type = $${values.length}::nexora.aggregate_type`);
  }

  if (filters.aggregateId !== undefined) {
    values.push(filters.aggregateId);
    conditions.push(`aggregate_id = $${values.length}::uuid`);
  }

  if (filters.afterSeq !== undefined) {
    values.push(filters.afterSeq);
    conditions.push(`seq > $${values.length}::bigint`);
  }

  values.push(filters.limit);
  const whereClause =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const rows = await q.query<EventRow>(
    `select ${COLUMNS}
       from nexora.events
       ${whereClause}
      order by seq asc
      limit $${values.length}`,
    values,
  );

  const items = rows.map(mapEvent);
  const last = items.at(-1);
  const nextSeq =
    items.length === filters.limit && last !== undefined ? last.seq : null;

  return { items, nextSeq };
}

function mapEvent(row: EventRow): EventEnvelope {
  const seq = Number(row.seq);
  if (!Number.isSafeInteger(seq)) {
    throw new Error(`Event sequence ${row.seq} exceeds the safe integer range`);
  }

  return {
    seq,
    id: row.id,
    type: row.type as EventEnvelope["type"],
    aggregateType: row.aggregate_type as EventEnvelope["aggregateType"],
    aggregateId: row.aggregate_id,
    actorId: row.actor_id,
    payload: row.payload,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    schemaVersion: row.schema_version,
    visibility: row.visibility,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
  };
}
