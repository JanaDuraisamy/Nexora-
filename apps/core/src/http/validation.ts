import type { ZodType, output as ZodOutput } from "zod";
import { badRequest } from "./errors.js";

export function parseInput<T extends ZodType>(
  schema: T,
  value: unknown,
): ZodOutput<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "Request validation failed",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  return result.data;
}
