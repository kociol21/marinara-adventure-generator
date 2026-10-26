import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { createProjectSchema, updateProjectSchema } from "@adv/shared";
import type { ProjectsRepo } from "../repos/projects.ts";

export const projectRoutes: FastifyPluginAsync<{ projects: ProjectsRepo; portraitsDir?: string }> = async (app, { projects, portraitsDir }) => {
  app.get("/", async () => projects.list());

  app.post("/", async (req, reply) => {
    const input = createProjectSchema.parse(req.body);
    return reply.status(201).send(projects.create(input));
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const project = projects.get(req.params.id);
    return project ?? reply.status(404).send({ error: "Project not found" });
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const input = updateProjectSchema.parse(req.body);
    const project = projects.update(req.params.id, input);
    return project ?? reply.status(404).send({ error: "Project not found" });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!projects.delete(req.params.id)) return reply.status(404).send({ error: "Project not found" });
    // Portrait files live outside the database; remove them with the project.
    if (portraitsDir) await rm(join(portraitsDir, req.params.id), { recursive: true, force: true });
    return reply.status(204).send();
  });
};
