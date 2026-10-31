import { z } from "zod";

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: optionalString,
  DATABASE_SSL: z.enum(["disable", "require"]).default("require"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  NEXORA_API_TOKEN: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0 ? undefined : value,
    z.string().min(16, "NEXORA_API_TOKEN must be at least 16 characters").optional(),
  ),
});

export type NodeEnvironment = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  databaseUrl: string | null;
  databaseSsl: "disable" | "require";
  corsOrigins: string[];
  apiToken: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid NEXORA Core configuration: ${summary}`);
  }

  const values = parsed.data;
  const config: AppConfig = {
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    databaseUrl: values.DATABASE_URL ?? null,
    databaseSsl: values.DATABASE_SSL,
    corsOrigins: values.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    apiToken: values.NEXORA_API_TOKEN ?? null,
  };

  if (config.nodeEnv === "production") {
    if (config.databaseUrl === null) {
      throw new Error("DATABASE_URL is required when NODE_ENV=production");
    }
    if (config.apiToken === null) {
      throw new Error("NEXORA_API_TOKEN is required when NODE_ENV=production");
    }
  }

  return config;
}
