import type { onRequestAsyncHookHandler } from "fastify";
import type { AppConfig } from "../config.js";
import type { CredentialDirectory } from "../auth/credentials.js";
import { unauthorized } from "./errors.js";

/**
 * Bearer authentication for the versioned API.
 *
 * Every `/v1` request must present a per-identity credential. The token is
 * resolved server-side and the resulting identity is the only source of actor
 * truth for the rest of the request. Health endpoints stay public.
 *
 * Supabase JWTs are a separate path used by direct database clients; they are
 * verified by Supabase and mapped through `nexora.identities.auth_user_id`.
 */
export function createAuthHook(
  directory: CredentialDirectory,
  config: AppConfig,
): onRequestAsyncHookHandler {
  return async (request) => {
    if (!request.url.startsWith("/v1")) {
      return;
    }

    const header = request.headers.authorization;
    const provided =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : null;

    if (provided === null || provided.length === 0) {
      throw unauthorized("A valid bearer token is required");
    }

    const actor = await directory.resolve(provided);
    if (actor === null) {
      // Deliberately identical for unknown, revoked and expired credentials.
      throw unauthorized("A valid bearer token is required");
    }

    request.actor = actor;

    if (config.nodeEnv === "test") {
      return;
    }

    request.log.debug(
      { actorId: actor.id, credentialId: actor.credentialId },
      "authenticated request",
    );
  };
}
