import type { FastifyPluginAsync } from "fastify";
import type { HealthResponse } from "@adv/shared";
import packageJson from "../../package.json" with { type: "json" };

export const healthRoutes: FastifyPluginAsync<{ dataDir: string; secretStore: HealthResponse["secretStore"] }> = async (
  app,
  options,
) => {
  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    version: packageJson.version,
    dataDir: options.dataDir,
    secretStore: options.secretStore,
  }));
};
