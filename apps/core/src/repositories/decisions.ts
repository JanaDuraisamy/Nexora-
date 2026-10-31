import type {
  Decision,
  DecisionStatus,
  ProposeDecisionData,
} from "@nexora/contracts";
import type { Queryable } from "../db.js";

interface DecisionRow {
  id: string;
  title: string;
  status: DecisionStatus;
  context: string;
  resolution: string | null;
  proposed_by: string;
  decided_by: string | null;
  decided_at: Date | null;
  adr_path: string | null;
  supersedes_id: string | null;
  metadata: Record<string, unknown>;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, title, status, context, resolution, proposed_by, decided_by, decided_at,
  adr_path, supersedes_id, metadata, version, created_at, updated_at
`;

export async function insertDecision(
  q: Queryable,
  input: ProposeDecisionData,
  proposedBy: string,
): Promise<Decision> {
  const rows = await q.query<DecisionRow>(
    `insert into nexora.decisions
       (title, context, proposed_by, adr_path, supersedes_id, metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning ${COLUMNS}`,
    [
      input.title,
      input.context,
      proposedBy,
      input.adrPath,
      input.supersedesId,
      JSON.stringify(input.metadata),
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Decision insert returned no row");
  }

  return mapDecision(row);
}

export async function findDecisionById(
  q: Queryable,
  id: string,
): Promise<Decision | null> {
  const rows = await q.query<DecisionRow>(
    `select ${COLUMNS} from nexora.decisions where id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? mapDecision(row) : null;
}

export async function listDecisions(
  q: Queryable,
  filters: { status?: DecisionStatus; limit: number },
): Promise<Decision[]> {
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (filters.status !== undefined) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}::nexora.decision_status`);
  }

  values.push(filters.limit);
  const whereClause =
    conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const rows = await q.query<DecisionRow>(
    `select ${COLUMNS}
       from nexora.decisions
       ${whereClause}
      order by created_at desc
      limit $${values.length}`,
    values,
  );

  return rows.map(mapDecision);
}

export async function applyDecision(
  q: Queryable,
  id: string,
  status: "approved" | "rejected",
  rationale: string,
  decidedBy: string,
  expectedVersion: number | null,
): Promise<Decision | null> {
  const rows = await q.query<DecisionRow>(
    `update nexora.decisions
        set status = $2::nexora.decision_status,
            resolution = $3,
            decided_by = $4,
            decided_at = now(),
            version = version + 1,
            updated_at = now()
      where id = $1
        and status = 'proposed'
        and ($5::integer is null or version = $5)
      returning ${COLUMNS}`,
    [id, status, rationale, decidedBy, expectedVersion],
  );

  const row = rows[0];
  return row ? mapDecision(row) : null;
}

function mapDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    context: row.context,
    resolution: row.resolution,
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at?.toISOString() ?? null,
    adrPath: row.adr_path,
    supersedesId: row.supersedes_id,
    metadata: row.metadata,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
