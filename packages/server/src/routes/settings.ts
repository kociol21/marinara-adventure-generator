import type { FastifyPluginAsync } from "fastify";
import { updateSettingsSchema } from "@adv/shared";
import type { SettingsRepo } from "../repos/settings.ts";

export const settingsRoutes: FastifyPluginAsync<{ settings: SettingsRepo }> = async (app, { settings }) => {
  app.get("/", async () => settings.get());

  app.patch("/", async (req) => settings.update(updateSettingsSchema.parse(req.body)));
};
