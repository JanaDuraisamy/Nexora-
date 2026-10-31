import type { Queryable } from "../db.js";

export interface CredentialActor {
  credentialId: string;
  identityId: string;
  handle: string;
  kind: "human" | "ai_agent";
  tier: "owner" | "tier_a" | "tier_b" | "tier_c";
}

interface CredentialActorRow {
  credential_id: string;
  identity_id: string;
  handle: string;
  kind: CredentialActor["kind"];
  tier: CredentialActor["tier"];
}

/**
 * Resolve a credential hash to an active identity.
 *
 * The lookup is a single indexed equality probe on a SHA-256 digest of a
 * 256-bit token. Revoked, expired and non-active identities all fail closed and
 * are indistinguishable from an unknown token to the caller.
 */
export async function findCredentialActor(
  q: Queryable,
  tokenHash: string,
): Promise<CredentialActor | null> {
  const rows = await q.query<CredentialActorRow>(
    `select c.id as credential_id,
            i.id as identity_id,
            i.handle,
            i.kind,
            i.tier
       from nexora.identity_credentials c
       join nexora.identities i on i.id = c.identity_id
      where c.token_hash = $1
        and c.revoked_at is null
        and (c.expires_at is null or c.expires_at > now())
        and i.status = 'active'`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    credentialId: row.credential_id,
    identityId: row.identity_id,
    handle: row.handle,
    kind: row.kind,
    tier: row.tier,
  };
}

export async function touchCredential(
  q: Queryable,
  credentialId: string,
): Promise<void> {
  await q.query(
    `update nexora.identity_credentials
        set last_used_at = now()
      where id = $1`,
    [credentialId],
  );
}

export interface CreateCredentialInput {
  identityId: string;
  tokenHash: string;
  label: string;
  createdBy: string | null;
  expiresAt: string | null;
}

/** Issues a credential row. Used by the operator script and integration tests. */
export async function createCredential(
  q: Queryable,
  input: CreateCredentialInput,
): Promise<string> {
  const rows = await q.query<{ id: string }>(
    `insert into nexora.identity_credentials
       (identity_id, token_hash, label, created_by, expires_at)
     values ($1, $2, $3, $4, $5::timestamptz)
     returning id`,
    [
      input.identityId,
      input.tokenHash,
      input.label,
      input.createdBy,
      input.expiresAt,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Credential insert returned no row");
  }

  return row.id;
}
