import type { CreateIdentityInput, Identity } from "@nexora/contracts";
import type { Queryable } from "../db.js";

interface IdentityRow {
  id: string;
  handle: string;
  display_name: string;
  kind: Identity["kind"];
  tier: Identity["tier"];
  status: Identity["status"];
  adapter_key: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  id, handle, display_name, kind, tier, status, adapter_key, metadata,
  created_at, updated_at
`;

export async function listIdentities(
  q: Queryable,
  limit: number,
): Promise<Identity[]> {
  const rows = await q.query<IdentityRow>(
    `select ${COLUMNS}
       from nexora.identities
      order by display_name asc
      limit $1`,
    [limit],
  );

  return rows.map(mapIdentity);
}

export async function findIdentityById(
  q: Queryable,
  id: string,
): Promise<Identity | null> {
  const rows = await q.query<IdentityRow>(
    `select ${COLUMNS} from nexora.identities where id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? mapIdentity(row) : null;
}

export async function findIdentityByHandle(
  q: Queryable,
  handle: string,
): Promise<Identity | null> {
  const rows = await q.query<IdentityRow>(
    `select ${COLUMNS} from nexora.identities where handle = $1`,
    [handle],
  );

  const row = rows[0];
  return row ? mapIdentity(row) : null;
}

export async function createIdentity(
  q: Queryable,
  input: CreateIdentityInput,
): Promise<Identity> {
  const rows = await q.query<IdentityRow>(
    `insert into nexora.identities
       (handle, display_name, kind, tier, status, adapter_key, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     returning ${COLUMNS}`,
    [
      input.handle,
      input.displayName,
      input.kind,
      input.tier,
      input.status,
      input.adapterKey,
      JSON.stringify(input.metadata),
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Identity insert returned no row");
  }

  return mapIdentity(row);
}

function mapIdentity(row: IdentityRow): Identity {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    kind: row.kind,
    tier: row.tier,
    status: row.status,
    adapterKey: row.adapter_key,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
