import { apiErrorSchema, type ApiErrorBody, type ApiErrorCode } from "@nexora/contracts";

export class NexoraApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode | "invalid_response" | "network_error" | "timeout";
  readonly details: unknown;

  constructor(
    statusCode: number,
    code: NexoraApiError["code"],
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "NexoraApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toNexoraApiError(
  statusCode: number,
  body: unknown,
  fallbackMessage: string,
): NexoraApiError {
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const envelope: ApiErrorBody = parsed.data;
    return new NexoraApiError(
      statusCode,
      envelope.error.code,
      envelope.error.message,
      envelope.error.details,
    );
  }

  return new NexoraApiError(statusCode, "invalid_response", fallbackMessage);
}
