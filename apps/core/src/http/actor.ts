import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

/**
 * The acting identity, derived from a verified server-side credential.
 *
 * Request bodies are never allowed to supply any of these values. Individual
 * fields mirror `nexora.identities`; `credentialId` identifies which secret was
 * used, so a rotation or revocation can be traced in logs.
 */
export interface AuthenticatedActor {
  id: string;
  handle: string;
  kind: "human" | "ai_agent";
  tier: "owner" | "tier_a" | "tier_b" | "tier_c";
  credentialId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthenticatedActor | null;
  }
}

export function currentActor(request: FastifyRequest): AuthenticatedActor {
  if (request.actor === null) {
    // Reached only if a route is registered outside the /v1 auth scope.
    throw unauthorized("Authentication required");
  }

  return request.actor;
}
