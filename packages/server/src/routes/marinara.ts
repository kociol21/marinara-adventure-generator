import type { FastifyPluginAsync } from "fastify";
import { MARINARA_PASSWORD_SECRET, MARINARA_USER_SECRET, pushRequestSchema, type MarinaraStatus } from "@adv/shared";
import type { FetchFn } from "../connections/http.ts";
import { createMarinaraClient, MarinaraError } from "../marinara/client.ts";
import { ExportBlockedError, SecretLeakError } from "../marinara/export.ts";
import { pushToMarinara, PushRefusedError } from "../marinara/push.ts";
import type { Pipeline } from "../pipeline/runner.ts";
import type { PushesRepo } from "../repos/pushes.ts";
import type { SecretsRepo } from "../repos/secrets.ts";
import type { SettingsRepo } from "../repos/settings.ts";

interface Deps {
  pipeline: Pipeline;
  pushes: PushesRepo;
  secrets: SecretsRepo;
  settings: SettingsRepo;
  fetch: FetchFn;
}

/** Push to Marinara (M8). Status reads only; push creates new resources in Marinara. */
export const marinaraRoutes: FastifyPluginAsync<Deps> = async (app, deps) => {
  const credentials = () => {
    const username = deps.secrets.reveal(MARINARA_USER_SECRET);
    const password = deps.secrets.reveal(MARINARA_PASSWORD_SECRET);
    return username && password ? { username, password } : null;
  };
  const client = () => {
    const baseUrl = deps.settings.get().marinaraBaseUrl;
    return baseUrl ? { baseUrl, client: createMarinaraClient({ baseUrl, credentials: credentials(), fetch: deps.fetch }) } : null;
  };
  const busy = new Set<string>();

  app.get("/marinara/status", async (): Promise<MarinaraStatus> => {
    const c = client();
    const status: MarinaraStatus = {
      baseUrl: c?.baseUrl ?? "",
      hasCredentials: credentials() !== null,
      reachable: false,
      authenticated: false,
      version: null,
      directorInstalled: null,
      embeddingConnections: [],
      error: c ? null : "Set the Marinara URL in Settings.",
    };
    if (!c) return status;
    try {
      const health = await c.client.health();
      Object.assign(status, { reachable: true, version: health.version, directorInstalled: health.directorReady });
    } catch (error) {
      // Some proxies put /api/health behind the login too; the next call tells.
      if (!(error instanceof MarinaraError && error.status === 401)) {
        status.error = error instanceof Error ? error.message : "Marinara could not be reached.";
        return status;
      }
      status.reachable = true;
    }
    try {
      const installed = await c.client.installedPackages();
      status.authenticated = true;
      status.directorInstalled = installed.includes("director");
      status.embeddingConnections = await c.client.embeddingConnections();
    } catch (error) {
      status.error = error instanceof Error ? error.message : "Marinara refused the request.";
    }
    return status;
  });

  app.get<{ Params: { id: string } }>("/projects/:id/marinara/pushes", async (req) => deps.pushes.list(req.params.id));

  app.post<{ Params: { id: string } }>("/projects/:id/marinara/push", async (req, reply) => {
    const body = pushRequestSchema.parse(req.body);
    const c = client();
    if (!c) return reply.status(409).send({ error: "Set the Marinara URL in Settings first." });
    const assembled = await deps.pipeline.exportable(req.params.id);
    if (!assembled) return reply.status(409).send({ error: "Finish generation before pushing." });
    if (busy.has(req.params.id)) return reply.status(409).send({ error: "A push of this adventure is already running." });
    busy.add(req.params.id);
    try {
      const secretValues = deps.secrets.list().flatMap((s) => deps.secrets.reveal(s.name) ?? []);
      const record = await pushToMarinara(
        c.client,
        c.baseUrl,
        assembled.package,
        { ...deps.pipeline.exportContext(req.params.id), secretValues },
        { withoutSecretPlot: body.withoutSecretPlot, vectorConnectionId: body.vectorConnectionId },
      );
      deps.pushes.add(req.params.id, record);
      return record;
    } catch (error) {
      if (error instanceof PushRefusedError) return reply.status(409).send({ error: error.message });
      if (error instanceof ExportBlockedError) return reply.status(409).send({ error: error.message, issues: error.issues.map((i) => i.summary) });
      if (error instanceof SecretLeakError) return reply.status(409).send({ error: error.message, issues: error.paths });
      // Failed before anything was created (status checks): nothing to undo.
      if (error instanceof MarinaraError) return reply.status(502).send({ error: error.message });
      throw error;
    } finally {
      busy.delete(req.params.id);
    }
  });
};
