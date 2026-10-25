import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { Db } from "./db/database.ts";
import { createProjectsRepo } from "./repos/projects.ts";
import { createSecretsRepo } from "./repos/secrets.ts";
import { createSettingsRepo } from "./repos/settings.ts";
import type { SecretStore } from "./secrets/secret-store.ts";
import { installSecurityHooks } from "./security.ts";
import { healthRoutes } from "./routes/health.ts";
import { projectRoutes } from "./routes/projects.ts";
import { secretRoutes } from "./routes/secrets.ts";
import { settingsRoutes } from "./routes/settings.ts";

export interface AppDeps {
  db: Db;
  secretStore: SecretStore;
  dataDir: string;
  port: number;
  /** Extra ports allowed in Host/Origin, e.g. the Vite dev server. */
  trustedPorts?: number[];
  webDistDir?: string;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ? { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] } : false,
  });

  installSecurityHooks(app, { ports: [deps.port, ...(deps.trustedPorts ?? [])] });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "Invalid request", issues: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.status(status).send({ error: status >= 500 ? "Internal server error" : (error as Error).message });
  });

  const repos = {
    projects: createProjectsRepo(deps.db),
    settings: createSettingsRepo(deps.db),
    secrets: createSecretsRepo(deps.db, deps.secretStore),
  };

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { dataDir: deps.dataDir, secretStore: deps.secretStore.kind });
      await api.register(projectRoutes, { prefix: "/projects", projects: repos.projects });
      await api.register(settingsRoutes, { prefix: "/settings", settings: repos.settings });
      await api.register(secretRoutes, { prefix: "/secrets", secrets: repos.secrets });
    },
    { prefix: "/api" },
  );

  if (deps.webDistDir && existsSync(deps.webDistDir)) {
    await app.register(fastifyStatic, { root: deps.webDistDir });
    // SPA fallback: unknown non-API GETs serve the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.status(404).send({ error: "Not found" });
    });
  }

  return app;
}
