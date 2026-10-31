import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  let app: FastifyInstance | undefined;

  try {
    app = await buildApp({ config });
    await app.listen({ host: config.host, port: config.port });

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void (async () => {
          app?.log.info({ signal }, "shutting down");
          await app?.close();
        })();
      });
    }
  } catch (error) {
    if (app) {
      app.log.error({ err: error }, "failed to start NEXORA Core");
    } else {
      console.error(error);
    }
    process.exitCode = 1;
    await app?.close();
  }
}

void main();
