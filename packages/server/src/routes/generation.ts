import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { retryStageSchema, startGenerationSchema } from "@adv/shared";
import { PipelineError, type Pipeline } from "../pipeline/runner.ts";
import { buildExport, buildExportZip, ExportBlockedError, SecretLeakError } from "../marinara/export.ts";
import type { SecretsRepo } from "../repos/secrets.ts";

export const generationRoutes: FastifyPluginAsync<{ pipeline: Pipeline; secrets: SecretsRepo }> = async (app, { pipeline, secrets }) => {
  /** Stored keys and tokens, server-side only, so the export can refuse files that contain one. */
  const secretValues = () => secrets.list().flatMap((s) => secrets.reveal(s.name) ?? []);
  const exportBlocked = (reply: FastifyReply, error: unknown) => {
    if (error instanceof ExportBlockedError) return reply.status(409).send({ error: error.message, issues: error.issues.map((i) => i.summary) });
    if (error instanceof SecretLeakError) return reply.status(409).send({ error: error.message, issues: error.paths });
    throw error;
  };
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
    const { note } = retryStageSchema.parse(req.body);
    try {
      return pipeline.retry(req.params.id, req.params.stage, note);
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

  /** What the bundle will contain: manifest and validation notes, without file contents. */
  app.get<{ Params: { id: string } }>("/:id/export/summary", async (req, reply) => {
    const assembled = await pipeline.exportable(req.params.id);
    if (!assembled) return reply.status(409).send({ error: "Finish generation before exporting." });
    try {
      const { manifest, issues } = buildExport(assembled.package, { ...pipeline.exportContext(req.params.id), secretValues: secretValues() });
      return { manifest, notes: issues.filter((i) => i.severity !== "error").map((i) => i.summary) };
    } catch (error) {
      return exportBlocked(reply, error);
    }
  });

  /** Download the Marinara import bundle (zip). */
  app.get<{ Params: { id: string } }>("/:id/export", async (req, reply) => {
    const assembled = await pipeline.exportable(req.params.id);
    if (!assembled) return reply.status(409).send({ error: "Finish generation before exporting." });
    try {
      const { fileName, zip } = buildExportZip(assembled.package, { ...pipeline.exportContext(req.params.id), secretValues: secretValues() });
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .send(zip);
    } catch (error) {
      return exportBlocked(reply, error);
    }
  });
};
