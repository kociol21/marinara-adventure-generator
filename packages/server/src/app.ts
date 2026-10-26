import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import type { Db } from "./db/database.ts";
import { createConnectionsRepo } from "./repos/connections.ts";
import { createProjectsRepo } from "./repos/projects.ts";
import { createSecretsRepo } from "./repos/secrets.ts";
import { createSettingsRepo } from "./repos/settings.ts";
import type { SecretStore } from "./secrets/secret-store.ts";
import { installSecurityHooks } from "./security.ts";
import { healthRoutes } from "./routes/health.ts";
import { projectRoutes } from "./routes/projects.ts";
import { secretRoutes } from "./routes/secrets.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { assignmentRoutes, connectionRoutes } from "./routes/connections.ts";
import { createCodexAuth, type CodexAuthClient } from "./connections/codex-auth.ts";
import type { FetchFn } from "./connections/http.ts";
import { createInterviewRepo } from "./repos/interview.ts";
import { createInterviewService } from "./interview/interview.ts";
import { createTextGenerator } from "./generation/text.ts";
import { createEmbedder } from "./generation/embeddings.ts";
import { createImageGenerator } from "./generation/images.ts";
import { portraitRoutes } from "./routes/portraits.ts";
import { join } from "node:path";
import { interviewRoutes } from "./routes/interview.ts";
import { generationRoutes } from "./routes/generation.ts";
import { createPipeline } from "./pipeline/runner.ts";
import { createStagesRepo } from "./repos/stages.ts";

export interface AppDeps {
  db: Db;
  secretStore: SecretStore;
  dataDir: string;
  port: number;
  /** Extra ports allowed in Host/Origin, e.g. the Vite dev server. */
  trustedPorts?: number[];
  webDistDir?: string;
  logger?: boolean;
  /** Outbound HTTP for providers; replaced in tests. */
  fetch?: FetchFn;
  codexAuth?: CodexAuthClient;
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

  const secrets = createSecretsRepo(deps.db, deps.secretStore);
  const repos = {
    projects: createProjectsRepo(deps.db),
    settings: createSettingsRepo(deps.db),
    secrets,
    connections: createConnectionsRepo(deps.db, secrets),
  };
  const fetchFn = deps.fetch ?? fetch;
  const adapterDeps = { fetch: fetchFn, codexAuth: deps.codexAuth ?? createCodexAuth({ fetch: fetchFn }) };
  const text = createTextGenerator(deps.db, repos.connections, adapterDeps);
  const interviewRepo = createInterviewRepo(deps.db);
  const interview = createInterviewService({ interview: interviewRepo, projects: repos.projects, text });
  const stagesRepo = createStagesRepo(deps.db);
  const images = createImageGenerator(deps.db, repos.connections, adapterDeps);
  const portraitsDir = join(deps.dataDir, "portraits");
  const pipeline = createPipeline({
    stages: stagesRepo,
    interview: interviewRepo,
    projects: repos.projects,
    settings: repos.settings,
    text,
    embedder: createEmbedder(deps.db, repos.connections, adapterDeps),
    images,
    portraitsDir,
    log: app.log,
  });
  app.decorate("pipeline", pipeline);

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { dataDir: deps.dataDir, secretStore: deps.secretStore.kind });
      await api.register(projectRoutes, { prefix: "/projects", projects: repos.projects, portraitsDir });
      await api.register(interviewRoutes, { prefix: "/projects", projects: repos.projects, interview });
      await api.register(generationRoutes, { prefix: "/projects", pipeline });
      await api.register(portraitRoutes, { prefix: "/projects", projects: repos.projects, stages: stagesRepo, images, portraitsDir });
      await api.register(settingsRoutes, { prefix: "/settings", settings: repos.settings });
      await api.register(secretRoutes, { prefix: "/secrets", secrets: repos.secrets });
      await api.register(connectionRoutes, { prefix: "/connections", connections: repos.connections, adapterDeps });
      await api.register(assignmentRoutes, { prefix: "/assignments", connections: repos.connections });
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
