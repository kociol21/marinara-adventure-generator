import type { FastifyPluginAsync } from "fastify";
import type { ProjectsRepo } from "../repos/projects.ts";
import type { UsageRepo } from "../repos/usage.ts";

/** Requests, tokens and cost: per adventure, and a forecast for the next generation run. */
export const usageRoutes: FastifyPluginAsync<{ projects: ProjectsRepo; usage: UsageRepo }> = async (app, { projects, usage }) => {
  app.get<{ Params: { id: string } }>("/projects/:id/usage", async (req, reply) => {
    if (!projects.get(req.params.id)) return reply.status(404).send({ error: "Project not found" });
    return usage.forProject(req.params.id);
  });

  app.get<{ Querystring: { exclude?: string } }>("/usage/estimate", async (req) => usage.estimate(req.query.exclude ?? ""));
};
