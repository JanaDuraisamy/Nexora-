import { timingSafeEqual } from "node:crypto";
import type { onRequestAsyncHookHandler } from "fastify";
import type { AppConfig } from "../config.js";
import { unauthorized } from "./errors.js";

/**
 * Phase 0 authentication is a single shared service token for the hub.
 * Per-identity credentials and token rotation are Phase 1 work; see
 * docs/specs/phase-0-foundation.md before exposing this API publicly.
 */
export function createAuthHook(
  config: AppConfig,
): onRequestAsyncHookHandler {
  return async (request) => {
    if (!request.url.startsWith("/v1")) {
      return;
    }

    if (config.apiToken === null) {
      if (config.nodeEnv === "production") {
        throw unauthorized("NEXORA_API_TOKEN is not configured");
      }
      return;
    }

    const header = request.headers.authorization;
    const provided =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : null;

    if (provided === null || !constantTimeEquals(provided, config.apiToken)) {
      throw unauthorized("A valid bearer token is required");
    }
  };
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
