import { createHash } from "node:crypto";
import type { DatabasePort } from "../db.js";
import type { AuthenticatedActor } from "../http/actor.js";
import {
  findCredentialActor,
  touchCredential,
} from "../repositories/credentials.js";

/** Resolves a bearer token to an identity, or to `null` when it is not valid. */
export interface CredentialDirectory {
  resolve(token: string): Promise<AuthenticatedActor | null>;
}

/**
 * SHA-256 hex digest of a credential token.
 *
 * Tokens are generated with 256 bits of entropy, so a fast hash is the correct
 * choice: it makes the database lookup a single indexed probe while ensuring a
 * leaked dump contains no usable credentials. This is not password storage.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class DatabaseCredentialDirectory implements CredentialDirectory {
  constructor(private readonly db: DatabasePort) {}

  async resolve(token: string): Promise<AuthenticatedActor | null> {
    const actor = await findCredentialActor(this.db, hashToken(token));
    if (actor === null) {
      return null;
    }

    // Best-effort telemetry. A failed timestamp update must not fail a request
    // that was otherwise authenticated.
    void touchCredential(this.db, actor.credentialId).catch(() => undefined);

    return {
      id: actor.identityId,
      handle: actor.handle,
      kind: actor.kind,
      tier: actor.tier,
      credentialId: actor.credentialId,
    };
  }
}
