import type { FastifyPluginAsync } from "fastify";
import { putSecretSchema, secretNameSchema } from "@adv/shared";
import type { SecretsRepo } from "../repos/secrets.ts";

/** Write-only API: secrets can be listed (names), set and deleted, never read back. */
export const secretRoutes: FastifyPluginAsync<{ secrets: SecretsRepo }> = async (app, { secrets }) => {
  app.get("/", async () => secrets.list());

  app.put<{ Params: { name: string } }>("/:name", async (req) => {
    const name = secretNameSchema.parse(req.params.name);
    const { value } = putSecretSchema.parse(req.body);
    return secrets.set(name, value);
  });

  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    const name = secretNameSchema.parse(req.params.name);
    if (!secrets.delete(name)) return reply.status(404).send({ error: "Secret not found" });
    return reply.status(204).send();
  });
};
