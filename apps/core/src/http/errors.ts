import type { ApiErrorCode } from "@nexora/contracts";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, "bad_request", message, details);
}

export function unauthorized(message = "Authentication required"): ApiError {
  return new ApiError(401, "unauthorized", message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "not_found", message);
}

export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, "conflict", message, details);
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(503, "service_unavailable", message);
}
