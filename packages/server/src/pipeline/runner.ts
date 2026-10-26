import { createHash } from "node:crypto";
import type { AuditReportView, GenerationState, Requirements, StageView } from "@adv/shared";
import type { FastifyBaseLogger } from "fastify";
import type { InterviewRepo } from "../repos/interview.ts";
import type { ProjectsRepo } from "../repos/projects.ts";
import type { SettingsRepo } from "../repos/settings.ts";
import type { StageRow, StagesRepo } from "../repos/stages.ts";
import { GenerationError, type TextGenerator } from "../generation/text.ts";
import { PROMPT_VERSION } from "./prompts.ts";
import { buildStages, FIXABLE_STAGE, type AvatarOutput, PackageInvalidError, type AssembleOutput, type StageContext, type StageDef } from "./stages.ts";
import type { AuditOutput } from "../audit/units.ts";
import type { Embedder } from "../generation/embeddings.ts";
import type { ImageGenerator } from "../generation/images.ts";
import { portraitDataUrl } from "./portraits.ts";
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
  embedder?: Embedder;
  images?: ImageGenerator;
  /** Where portrait PNGs are stored. */
  portraitsDir?: string;
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

  function definitions(projectId: string, requirements: Requirements, rows: Map<string, StageRow>): StageDef[] {
    const plan = rows.get("plan");
    return buildStages(requirements, plan?.status === "done" ? (plan.output as Plan) : null, {
      settings: deps.projects.portraits(projectId),
      available: !!deps.images?.describe(),
    });
  }

  type Notes = Map<string, Array<{ round: number; note: string }>>;
  const NO_NOTES: Notes = new Map();

  function inputHash(def: StageDef, hashBase: string, title: string, rows: Map<string, StageRow>, notes: Notes): string {
    // Version and audit notes join the hash only when present, so existing stage hashes stay valid.
    const stageNotes = (notes.get(def.id) ?? []).map((n) => n.note);
    return sha([
      PROMPT_VERSION,
      def.id,
      ...(def.version ? [`v${def.version}`] : []),
      ...(stageNotes.length ? [`notes:${sha(stageNotes)}`] : []),
      hashBase,
      title,
      ...def.deps.map((d) => rows.get(d)?.outputHash ?? "missing"),
    ]);
  }

  /** Done and still valid for the current inputs. */
  function isCurrent(def: StageDef, hashBase: string, title: string, rows: Map<string, StageRow>, notes: Notes): boolean {
    const row = rows.get(def.id);
    return row?.status === "done" && row.inputHash === inputHash(def, hashBase, title, rows, notes);
  }

  /** Major findings the audit can send back to a rendering stage. */
  function fixable(audit: AuditOutput | undefined) {
    return (audit?.findings ?? []).filter((f) => f.severity === "major" && f.target && FIXABLE_STAGE.test(f.target));
  }

  function state(projectId: string): GenerationState {
    const project = deps.projects.get(projectId);
    const showSpoilers = deps.settings.get().showSpoilers;
    const current = deps.interview.current(projectId);
    const rows = deps.stages.all(projectId);
    if (!project || !current?.approvedAt) {
      return { running: jobs.has(projectId), stages: [], warnings: [], notes: [], ready: false, audit: null };
    }
    const hashBase = sha(current.requirements);
    const defs = definitions(projectId, current.requirements, rows);
    const notes = deps.stages.notes(projectId, hashBase);
    const calls = deps.stages.callCounts(projectId);
    const stages: StageView[] = defs.map((def) => {
      const row = rows.get(def.id);
      const stale = row?.status === "done" && !isCurrent(def, hashBase, project.title, rows, notes);
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
    const auditRow = rows.get("audit");
    const auditOut = auditRow?.status === "done" ? (auditRow.output as AuditOutput) : null;
    const audit: AuditReportView | null = auditOut
      ? {
          fixRounds: deps.stages.fixRounds(projectId, hashBase),
          maxFixRounds: deps.settings.get().maxAutoFixAttempts,
          ...portraitScope(rows, auditOut, deps.projects.portraits(projectId).enabled, !!deps.images?.describe()),
          findings: auditOut.findings.map((f) => ({
            id: f.id,
            area: f.area,
            severity: f.severity,
            where: f.where,
            summary: f.summary,
            source: f.source,
            // A finding no single rendering stage can fix sits in the plan or facts (e.g. a logic hole).
            fix: f.target && FIXABLE_STAGE.test(f.target) ? "auto" : f.target === null && f.where === "Package" ? "plan" : "none",
            ...(showSpoilers ? { detail: f.detail } : {}),
          })),
        }
      : null;
    return { running: jobs.has(projectId), stages, warnings: of("warning"), notes: of("info"), ready, audit };
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
      const defs = definitions(projectId, requirements, rows);
      const notes = deps.stages.notes(projectId, hashBase);
      if (rows.get("plan")?.status === "done") deps.stages.prune(projectId, defs.map((d) => d.id));
      const next = defs.find((def) => !isCurrent(def, hashBase, project.title, rows, notes));
      if (!next) {
        // Everything is current. Send major audit findings back to their stages, up to the round limit (spec §15).
        const toFix = fixable(rows.get("audit")?.output as AuditOutput | undefined);
        if (toFix.length > 0 && deps.stages.fixRounds(projectId, hashBase) < repairAttempts) {
          const round = deps.stages.lastRound(projectId, hashBase) + 1;
          deps.stages.addNotes(projectId, hashBase, round, toFix.map((f) => ({ stage: f.target!, note: f.fix ?? f.detail })));
          continue;
        }
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
        revision: (id) => {
          const stageNotes = notes.get(id) ?? [];
          const row = rows.get(id);
          const def = defs.find((d) => d.id === id);
          // Edit the previous output only when nothing but the notes changed since it was written.
          const sameBase = !!def && !!row?.output && row.baseHash === inputHash(def, hashBase, project.title, rows, NO_NOTES);
          return { notes: stageNotes, previous: sameBase ? row!.output : null };
        },
        embedder: deps.embedder ?? null,
        images: deps.images ?? null,
        portraits: { settings: deps.projects.portraits(projectId), dir: deps.portraitsDir ?? "portraits" },
        output: <T>(id: string) => {
          const row = rows.get(id);
          if (row?.status !== "done") throw new Error(`Stage ${id} has no result.`);
          return row.output as T;
        },
      };

      deps.stages.start(
        projectId,
        next.id,
        inputHash(next, hashBase, project.title, rows, notes),
        inputHash(next, hashBase, project.title, rows, NO_NOTES),
      );
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

    /**
     * Audit again with a fresh fix-round budget. Earlier notes stay in force (they are part of
     * their stages' hashes), so nothing already fixed is regenerated from scratch.
     */
    rerunAudit(projectId: string): GenerationState {
      if (jobs.has(projectId)) throw new PipelineError("Generation is already running.", 409);
      const { hashBase } = approvedRequirements(projectId);
      deps.stages.newFixSession(projectId, hashBase);
      if (deps.stages.all(projectId).has("audit")) deps.stages.invalidate(projectId, "audit");
      return start(projectId);
    },

    /** The assembled package, once every stage is done. Contains the hidden story. */
    /** The package with finished portraits attached, for export and push. Contains the hidden story. */
    async exportable(projectId: string): Promise<AssembleOutput | null> {
      const assembled = this.assembled(projectId);
      if (!assembled) return null;
      const rows = deps.stages.all(projectId);
      // Only portraits of the current plan: turning portraits off must drop older ones from the export.
      const current = new Set(state(projectId).stages.map((s) => s.id));
      const portrait = async (stage: string) => {
        const row = rows.get(stage);
        return current.has(stage) && row?.status === "done" && deps.portraitsDir
          ? portraitDataUrl(deps.portraitsDir, row.output as AvatarOutput)
          : undefined;
      };
      const pkg = structuredClone(assembled.package);
      for (const card of pkg.characters) {
        const avatar = await portrait(`avatar:${card.key}`);
        if (avatar) card.avatar = avatar;
      }
      if (pkg.persona) {
        const avatar = await portrait("avatar:persona");
        if (avatar) pkg.persona.avatar = avatar;
      }
      return { ...assembled, package: pkg };
    },

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

/** Portraits are checked in their own stages; fold their results into the audit's scope lists. */
function portraitScope(rows: Map<string, StageRow>, audit: AuditOutput, enabled: boolean, available: boolean) {
  const notChecked = audit.notChecked.filter((line) => !line.startsWith("Portraits"));
  const checked = [...audit.checked];
  const avatars = [...rows.values()].filter((r) => r.stage.startsWith("avatar:") && r.status === "done").map((r) => (r.output as AvatarOutput).check);
  if (!enabled) notChecked.push("Portraits (turned off for this adventure)");
  else if (!available) notChecked.push("Portraits (no image model assigned)");
  else if (avatars.length) {
    const n = (c: string) => avatars.filter((x) => x === c).length;
    checked.push(`Portraits against Appearance and style (vision review): ${n("match")} match, ${n("mismatch")} may not match, ${n("unchecked")} not checkable`);
  } else notChecked.push("Portraits (not generated yet)");
  return { checked, notChecked };
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
