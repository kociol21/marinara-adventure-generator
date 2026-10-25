import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { interviewMessageInputSchema, updateRequirementsSchema } from "@adv/shared";
import type { ProjectsRepo } from "../repos/projects.ts";
import { ApprovalError, type InterviewService } from "../interview/interview.ts";
import { GenerationError } from "../generation/text.ts";

interface Options {
  projects: ProjectsRepo;
  interview: InterviewService;
}

export const interviewRoutes: FastifyPluginAsync<Options> = async (app, { projects, interview }) => {
  const missing = (reply: FastifyReply) => reply.status(404).send({ error: "Project not found" });

  app.get<{ Params: { id: string } }>("/:id/interview", async (req, reply) => {
    if (!projects.get(req.params.id)) return missing(reply);
    return interview.state(req.params.id);
  });

  /** Sends one interview turn to the assigned text model (uses quota or credits). */
  app.post<{ Params: { id: string } }>("/:id/interview/messages", async (req, reply) => {
    const { content } = interviewMessageInputSchema.parse(req.body);
    if (!projects.get(req.params.id)) return missing(reply);
    try {
      return await interview.reply(req.params.id, content);
    } catch (error) {
      if (error instanceof GenerationError) {
        return reply.status(error.code === "not-assigned" ? 409 : 502).send({ error: error.message, state: interview.state(req.params.id) });
      }
      throw error;
    }
  });

  app.put<{ Params: { id: string } }>("/:id/requirements", async (req, reply) => {
    const { requirements, assumptions } = updateRequirementsSchema.parse(req.body);
    if (!projects.get(req.params.id)) return missing(reply);
    return interview.edit(req.params.id, requirements, assumptions);
  });

  app.post<{ Params: { id: string } }>("/:id/requirements/approve", async (req, reply) => {
    if (!projects.get(req.params.id)) return missing(reply);
    try {
      return interview.approve(req.params.id);
    } catch (error) {
      if (error instanceof ApprovalError) return reply.status(400).send({ error: error.message });
      throw error;
    }
  });
};
