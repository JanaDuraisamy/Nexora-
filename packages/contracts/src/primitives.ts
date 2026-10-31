import { z } from "zod";

/**
 * Shared primitives used by every NEXORA contract.
 *
 * Timestamps cross the API boundary as ISO-8601 strings so that contracts stay
 * transport-neutral (HTTP today, potentially queues or sockets later).
 */
export const identifierSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const metadataSchema = z.record(z.string(), z.unknown());

export const handleSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_-]{1,31}$/,
    "Handle must be 2-32 characters, start with a lowercase letter, and contain only lowercase letters, digits, '_' or '-'",
  );

export function requiredText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

export function optionalText(maxLength: number) {
  return z.string().trim().max(maxLength);
}

/**
 * Client-generated idempotency key. Scoped per identity and operation by the
 * server, so two callers may safely reuse the same value.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "Idempotency keys may contain letters, digits, '.', '_', ':' and '-'",
  );
