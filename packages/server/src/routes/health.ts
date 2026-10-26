import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse } from "@adv/shared";
import packageJson from "../../package.json" with { type: "json" };

export const healthRoutes: FastifyPluginAsync<{ dataDir: string; secretStore: HealthResponse["secretStore"]; stop?: () => void }> = async (
  app,
  options,
) => {
  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    version: packageJson.version,
    dataDir: options.dataDir,
    secretStore: options.secretStore,
    canStop: !!options.stop,
  }));

  /** The launcher runs the server without a window, so the app is where it is stopped. */
  app.post("/server/stop", async (_req, reply) => {
    if (!options.stop) return reply.status(409).send({ error: "This server cannot be stopped from the app." });
    // Answer first; the browser then sees the server go offline.
    setTimeout(options.stop, 200);
    return { stopping: true };
  });
};
