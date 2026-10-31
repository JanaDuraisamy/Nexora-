import { createHash } from "node:crypto";
import type { Queryable } from "../db.js";

export interface IdempotencyReservation {
  /** True when the key already existed and `resourceId` is the earlier result. */
  replayed: boolean;
  resourceId: string | null;
  payloadHash: string;
}

export interface ReserveIdempotencyInput {
  identityId: string;
  scope: string;
  key: string;
  resourceType: "identity" | "task" | "decision" | "permission" | "system";
  payloadHash: string;
}

/** Hash JSON payloads deterministically, independent of object key order. */
export function hashIdempotencyPayload(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

/**
 * Reserve an idempotency key inside the caller's transaction.
 *
 * `on conflict do nothing` makes a concurrent duplicate wait for the first
 * transaction to finish. If that transaction committed, the key is present with
 * a `resource_id` and the request is replayed. If it rolled back, the key
 * disappears and this caller proceeds normally.
 */
export async function reserveIdempotencyKey(
  q: Queryable,
  input: ReserveIdempotencyInput,
): Promise<IdempotencyReservation> {
  const inserted = await q.query<{
    resource_id: string | null;
    payload_hash: string;
  }>(
    `insert into nexora.idempotency_keys
       (identity_id, scope, key, resource_type, payload_hash)
     values ($1, $2, $3, $4::nexora.aggregate_type, $5)
     on conflict (identity_id, scope, key) do nothing
     returning resource_id, payload_hash`,
    [
      input.identityId,
      input.scope,
      input.key,
      input.resourceType,
      input.payloadHash,
    ],
  );

  if (inserted.length > 0) {
    return {
      replayed: false,
      resourceId: inserted[0]?.resource_id ?? null,
      payloadHash: inserted[0]?.payload_hash ?? input.payloadHash,
    };
  }

  const existing = await q.query<{
    resource_id: string | null;
    payload_hash: string;
  }>(
    `select resource_id, payload_hash
       from nexora.idempotency_keys
      where identity_id = $1
        and scope = $2
        and key = $3`,
    [input.identityId, input.scope, input.key],
  );

  const row = existing[0];
  if (!row) {
    throw new Error("Idempotency reservation disappeared during lookup");
  }

  return {
    replayed: true,
    resourceId: row.resource_id,
    payloadHash: row.payload_hash,
  };
}

/** Attach the created resource to a reservation made in the same transaction. */
export async function attachIdempotencyResource(
  q: Queryable,
  input: ReserveIdempotencyInput,
  resourceId: string,
): Promise<void> {
  await q.query(
    `update nexora.idempotency_keys
        set resource_id = $4
      where identity_id = $1
        and scope = $2
        and key = $3`,
    [input.identityId, input.scope, input.key, resourceId],
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}
