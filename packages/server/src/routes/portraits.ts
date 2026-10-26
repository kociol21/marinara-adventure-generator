import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { portraitSettingsSchema } from "@adv/shared";
import type { ProjectsRepo } from "../repos/projects.ts";
import type { StagesRepo } from "../repos/stages.ts";
import type { ImageGenerator } from "../generation/images.ts";
import type { AvatarOutput } from "../pipeline/stages.ts";

interface Options {
  projects: ProjectsRepo;
  stages: StagesRepo;
  images: ImageGenerator;
  portraitsDir: string;
}

/** Portrait settings and images. Portraits are player-visible material, so serving them is not a spoiler. */
export const portraitRoutes: FastifyPluginAsync<Options> = async (app, { projects, stages, images, portraitsDir }) => {
  app.get<{ Params: { id: string } }>("/:id/portraits", async (req, reply) => {
    if (!projects.get(req.params.id)) return reply.status(404).send({ error: "Project not found" });
    const rows = stages.all(req.params.id);
    const done = [...rows.values()]
      .filter((r) => r.stage.startsWith("avatar:") && r.status === "done")
      .map((r) => ({ stage: r.stage, check: (r.output as AvatarOutput).check }));
    return { settings: projects.portraits(req.params.id), imageModel: images.describe(), portraits: done };
  });

  app.put<{ Params: { id: string } }>("/:id/portraits", async (req, reply) => {
    const settings = portraitSettingsSchema.parse(req.body);
    if (!projects.get(req.params.id)) return reply.status(404).send({ error: "Project not found" });
    projects.setPortraits(req.params.id, settings);
    return { settings };
  });

  app.get<{ Params: { id: string; stage: string } }>("/:id/portraits/:stage/image", async (req, reply) => {
    const row = stages.all(req.params.id).get(req.params.stage);
    if (!req.params.stage.startsWith("avatar:") || row?.status !== "done") return reply.status(404).send({ error: "No portrait" });
    const path = resolve(portraitsDir, (row.output as AvatarOutput).file);
    // The file name comes from our own stage output, but stay inside the portraits folder regardless.
    if (!path.startsWith(resolve(portraitsDir)) || !existsSync(path)) return reply.status(404).send({ error: "No portrait" });
    return reply.header("Content-Type", "image/png").header("Cache-Control", "no-cache").send(createReadStream(path));
  });
};

export const portraitDir = (dataDir: string) => join(dataDir, "portraits");
