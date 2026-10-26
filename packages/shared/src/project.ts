import { z } from "zod";
import type { AuditReportView } from "./audit.ts";

export const projectStatusSchema = z.enum(["draft", "interview", "approved", "generating", "ready", "exported"]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSchema = z.object({
  id: z.string(),
  /** Working title the player typed; it labels the project until the adventure has its own title. */
  title: z.string(),
  /** Title chosen by the title stage, used in exports and Marinara; empty until generated. */
  name: z.string(),
  status: projectStatusSchema,
  /** Spoiler-free teaser; the only story text the library ever shows. */
  teaser: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export type StageStatus = "pending" | "running" | "done" | "failed" | "stale";

/** Spoiler-free view of one pipeline stage. */
export interface StageView {
  id: string;
  label: string;
  status: StageStatus;
  summary: string | null;
  error: string | null;
  /** Hidden-content detail of a failure; present only when "Show spoilers" is on. */
  errorDetail?: string | null;
  attempts: number;
  /** Model requests in the latest run of this stage, repairs included. */
  calls: number;
  finishedAt: string | null;
  /** The player may send this stage a change request. */
  acceptsNote: boolean;
  /** The player's own requests for this stage, oldest first. */
  playerNotes: string[];
}

export interface GenerationState {
  running: boolean;
  /** Stages known so far; card and lorebook stages appear once the plan exists. */
  stages: StageView[];
  /** Validation warnings of the assembled package, spoiler-free summaries only. */
  warnings: string[];
  /** Informational notes from validation (not problems). */
  notes: string[];
  /** Quality audit of the latest assembled package, when it has run. */
  audit: AuditReportView | null;
  /** The adventure's generated title, when its stage is done and current. */
  title: string | null;
  ready: boolean;
}

export const startGenerationSchema = z.object({ confirmUsage: z.literal(true) });

/** Regenerate a stage, optionally with the player's change request ("make the opening funnier"). */
export const retryStageSchema = startGenerationSchema.extend({ note: z.string().trim().min(1).max(1000).optional() });

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    teaser: z.string().max(2000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
