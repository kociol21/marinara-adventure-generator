/** Quality audit of a generated adventure (spec §11-12). */

export type AuditArea =
  | "structure"
  | "consistency"
  | "voices"
  | "duplicates"
  | "mystery"
  | "activation"
  | "spoilers"
  | "style";

export type AuditSeverity = "major" | "minor";

export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  structure: "Structure and format",
  consistency: "Consistency of world, characters and timeline",
  voices: "Distinct character voices and goals",
  duplicates: "Repeated or conflicting information",
  mystery: "Mystery logic and solvability",
  activation: "Lorebook activation and clue availability",
  spoilers: "Spoilers in material the player sees",
  style: "Prose voice",
};

/** Spoiler-free view of one finding. */
export interface AuditFindingView {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  /** Part of the package, named only by what the player may see ("Card: Mara Vale", "Lorebook: Plot", "Teaser"). */
  where: string;
  /** Written by code from the area and place, never by the model, so it cannot carry hidden content. */
  summary: string;
  /** "code" or "model": who found it. Model findings are heuristic. */
  source: "code" | "model";
  /** How it can be fixed: automatically in one part, only by regenerating the plan, or not automatically. */
  fix: "auto" | "plan" | "none";
  /** Hidden-content explanation; present only when "Show spoilers" is on. */
  detail?: string;
}

export interface AuditReportView {
  /** Fix rounds already applied and the configured limit. */
  fixRounds: number;
  maxFixRounds: number;
  /** What was checked, and how. */
  checked: string[];
  /** What could not be checked in this run, and why. */
  notChecked: string[];
  findings: AuditFindingView[];
}
