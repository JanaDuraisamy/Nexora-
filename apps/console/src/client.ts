import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessResponse,
} from "@nexora/contracts";

/**
 * The console is public: it reads only the unauthenticated health endpoints.
 *
 * It deliberately does not use the authenticated SDK. Vite inlines every
 * `VITE_*` variable into the browser bundle, so no credential may exist here,
 * and the bundle has no code path that can send a bearer token. Authenticated
 * console features must go through a server-side proxy.
 */
const baseUrl = (
  import.meta.env.VITE_NEXORA_API_URL ?? "http://127.0.0.1:4000"
).replace(/\/+$/, "");

export const apiBaseUrl = baseUrl;

const TIMEOUT_MS = 5_000;

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  return response.json();
}

export async function fetchHealth(): Promise<HealthResponse> {
  return healthResponseSchema.parse(await getJson("/health"));
}

/** A 503 degraded response is still contract-valid and is returned normally. */
export async function fetchReadiness(): Promise<ReadinessResponse> {
  return readinessResponseSchema.parse(await getJson("/health/ready"));
}
