import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { startGenerationSchema } from "@adv/shared";
import { PipelineError, type Pipeline } from "../pipeline/runner.ts";
import { buildExportZip, ExportBlockedError } from "../marinara/export.ts";

export const generationRoutes: FastifyPluginAsync<{ pipeline: Pipeline }> = async (app, { pipeline }) => {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PipelineError) return reply.status(error.status).send({ error: error.message });
    throw error;
  };

  app.get<{ Params: { id: string } }>("/:id/generation", async (req) => pipeline.state(req.params.id));

  /** Starts or resumes generation. Each stage is a real model request (quota or credits). */
  app.post<{ Params: { id: string } }>("/:id/generation/start", async (req, reply) => {
    startGenerationSchema.parse(req.body);
    try {
      return pipeline.start(req.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/:id/generation/cancel", async (req) => pipeline.cancel(req.params.id));

  app.post<{ Params: { id: string; stage: string } }>("/:id/generation/stages/:stage/retry", async (req, reply) => {
    startGenerationSchema.parse(req.body);
    try {
      return pipeline.retry(req.params.id, req.params.stage);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/:id/generation/audit/rerun", async (req, reply) => {
    startGenerationSchema.parse(req.body);
    try {
      return pipeline.rerunAudit(req.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** Download the Marinara import bundle (zip). */
  app.get<{ Params: { id: string } }>("/:id/export", async (req, reply) => {
    const assembled = await pipeline.exportable(req.params.id);
    if (!assembled) return reply.status(409).send({ error: "Finish generation before exporting." });
    try {
      // The bundle's QA report never carries details, whatever the spoiler setting.
      const audit = pipeline.state(req.params.id).audit;
      const spoilerFree = audit ? { ...audit, findings: audit.findings.map(({ detail: _detail, ...f }) => f) } : null;
      const { fileName, zip } = buildExportZip(assembled.package, spoilerFree);
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .send(zip);
    } catch (error) {
      if (error instanceof ExportBlockedError) {
        return reply.status(409).send({ error: error.message, issues: error.issues.map((i) => i.summary) });
      }
      throw error;
    }
  });
};
