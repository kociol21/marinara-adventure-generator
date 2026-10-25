import { createHash } from "node:crypto";
import type { GenerationState, Requirements, StageView } from "@adv/shared";
import type { FastifyBaseLogger } from "fastify";
import type { InterviewRepo } from "../repos/interview.ts";
import type { ProjectsRepo } from "../repos/projects.ts";
import type { SettingsRepo } from "../repos/settings.ts";
import type { StageRow, StagesRepo } from "../repos/stages.ts";
import { GenerationError, type TextGenerator } from "../generation/text.ts";
import { PROMPT_VERSION } from "./prompts.ts";
import { buildStages, PackageInvalidError, type AssembleOutput, type StageContext, type StageDef } from "./stages.ts";
import type { Opening, Plan } from "./schemas.ts";

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sha = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

interface Deps {
  stages: StagesRepo;
  interview: InterviewRepo;
  projects: ProjectsRepo;
  settings: SettingsRepo;
  text: TextGenerator;
  log?: FastifyBaseLogger;
}

/**
 * Runs the generation stages one after another (spec §15). Every stage result is stored with
 * the hash of its inputs, so a crash, a quota stop or a retry continues from the first stage
 * whose inputs changed; finished stages are reused. One job per project, in-process.
 */
export function createPipeline(deps: Deps) {
  const jobs = new Map<string, { cancelled: boolean; done: Promise<void> }>();
  deps.stages.resetRunning();

  function approvedRequirements(projectId: string): { requirements: Requirements; hashBase: string } {
    const current = deps.interview.current(projectId);
    if (!current?.approvedAt) throw new PipelineError("Approve the requirements before generating.", 400);
    return { requirements: current.requirements, hashBase: sha(current.requirements) };
  }

  function definitions(requirements: Requirements, rows: Map<string, StageRow>): StageDef[] {
    const plan = rows.get("plan");
    return buildStages(requirements, plan?.status === "done" ? (plan.output as Plan) : null);
  }

  function inputHash(def: StageDef, hashBase: string, title: string, rows: Map<string, StageRow>): string {
    return sha([PROMPT_VERSION, def.id, hashBase, title, ...def.deps.map((d) => rows.get(d)?.outputHash ?? "missing")]);
  }

  /** Done and still valid for the current inputs. */
  function isCurrent(def: StageDef, hashBase: string, title: string, rows: Map<string, StageRow>): boolean {
    const row = rows.get(def.id);
    return row?.status === "done" && row.inputHash === inputHash(def, hashBase, title, rows);
  }

  function state(projectId: string): GenerationState {
    const project = deps.projects.get(projectId);
    const showSpoilers = deps.settings.get().showSpoilers;
    const current = deps.interview.current(projectId);
    const rows = deps.stages.all(projectId);
    if (!project || !current?.approvedAt) {
      return { running: jobs.has(projectId), stages: [], warnings: [], notes: [], ready: false };
    }
    const hashBase = sha(current.requirements);
    const defs = definitions(current.requirements, rows);
    const calls = deps.stages.callCounts(projectId);
    const stages: StageView[] = defs.map((def) => {
      const row = rows.get(def.id);
      const stale = row?.status === "done" && !isCurrent(def, hashBase, project.title, rows);
      return {
        id: def.id,
        label: def.label,
        status: !row ? "pending" : stale ? "stale" : row.status,
        summary: row?.status === "done" && !stale ? row.summary : null,
        error: row?.status === "failed" ? row.error : null,
        ...(showSpoilers && row?.errorDetail ? { errorDetail: row.errorDetail } : {}),
        attempts: row?.attempts ?? 0,
        calls: calls.get(def.id) ?? 0,
        finishedAt: row?.finishedAt ?? null,
      };
    });
    const assembled = rows.get("assemble");
    const ready = stages.length > 1 && stages.every((s) => s.status === "done");
    const issues = ready ? (assembled!.output as AssembleOutput).issues : [];
    const of = (severity: string) => issues.filter((i) => i.severity === severity).map((i) => i.summary);
    return { running: jobs.has(projectId), stages, warnings: of("warning"), notes: of("info"), ready };
  }

  async function run(projectId: string, job: { cancelled: boolean }): Promise<void> {
    const project = deps.projects.get(projectId)!;
    const { requirements, hashBase } = approvedRequirements(projectId);
    const repairAttempts = deps.settings.get().maxAutoFixAttempts;
    deps.projects.setStatus(projectId, "generating");

    for (;;) {
      if (job.cancelled) {
        deps.projects.setStatus(projectId, "approved");
        return;
      }
      const rows = deps.stages.all(projectId);
      const defs = definitions(requirements, rows);
      if (rows.get("plan")?.status === "done") deps.stages.prune(projectId, defs.map((d) => d.id));
      const next = defs.find((def) => !isCurrent(def, hashBase, project.title, rows));
      if (!next) {
        deps.projects.setStatus(projectId, "ready");
        return;
      }

      const ctx: StageContext = {
        projectId,
        title: project.title,
        requirements,
        text: deps.text,
        repairAttempts,
        has: (id) => rows.get(id)?.status === "done",
        output: <T>(id: string) => {
          const row = rows.get(id);
          if (row?.status !== "done") throw new Error(`Stage ${id} has no result.`);
          return row.output as T;
        },
      };

      deps.stages.start(projectId, next.id, inputHash(next, hashBase, project.title, rows));
      try {
        const output = await next.run(ctx);
        deps.stages.finish(projectId, next.id, output, sha(output), next.summary(output));
        if (next.id === "opening") deps.projects.update(projectId, { teaser: (output as Opening).teaser });
      } catch (error) {
        const { message, detail } = describeFailure(error);
        if (!(error instanceof GenerationError) && !(error instanceof PackageInvalidError)) deps.log?.error(error, "Stage %s failed", next.id);
        deps.stages.fail(projectId, next.id, message, detail);
        deps.projects.setStatus(projectId, "approved");
        return;
      }
    }
  }

  function start(projectId: string): GenerationState {
    if (!deps.projects.get(projectId)) throw new PipelineError("Project not found", 404);
    if (jobs.has(projectId)) throw new PipelineError("Generation is already running.", 409);
    approvedRequirements(projectId);
    const job = { cancelled: false, done: Promise.resolve() };
    job.done = run(projectId, job)
      .catch((error) => deps.log?.error(error, "Pipeline crashed"))
      .finally(() => jobs.delete(projectId));
    jobs.set(projectId, job);
    return state(projectId);
  }

  return {
    state,
    start,

    /** Stops after the stage in progress; its result is kept if it completes. */
    cancel(projectId: string): GenerationState {
      const job = jobs.get(projectId);
      if (job) job.cancelled = true;
      return state(projectId);
    },

    /** Regenerate one stage (and, through the hashes, whatever depends on it). */
    retry(projectId: string, stageId: string): GenerationState {
      if (jobs.has(projectId)) throw new PipelineError("Generation is already running.", 409);
      const rows = deps.stages.all(projectId);
      if (!rows.has(stageId)) throw new PipelineError("Unknown stage.", 404);
      deps.stages.invalidate(projectId, stageId);
      return start(projectId);
    },

    /** The assembled package, once every stage is done. Contains the hidden story. */
    assembled(projectId: string): AssembleOutput | null {
      const s = state(projectId);
      if (!s.ready) return null;
      return deps.stages.all(projectId).get("assemble")!.output as AssembleOutput;
    },

    /** For tests and shutdown. */
    async idle(projectId: string): Promise<void> {
      await jobs.get(projectId)?.done;
    },
  };
}

function describeFailure(error: unknown): { message: string; detail: string | null } {
  if (error instanceof GenerationError) return { message: error.message, detail: error.detail ?? null };
  if (error instanceof PackageInvalidError) {
    const errors = error.issues.filter((i) => i.severity === "error");
    return {
      message: `${error.message} ${errors.map((i) => i.summary).join(" ")}`,
      detail: JSON.stringify(errors.map((i) => ({ code: i.code, summary: i.summary, detail: i.detail ?? null }))),
    };
  }
  return { message: "Unexpected error in this stage. Retry it, or check the server log.", detail: error instanceof Error ? error.message : null };
}

export type Pipeline = ReturnType<typeof createPipeline>;
