/** Quality audit of a generated adventure (spec §11-12). */

export type AuditArea =
  | "structure"
  | "consistency"
  | "voices"
  | "duplicates"
  | "mystery"
  | "activation"
  | "spoilers"
  | "style"
  | "fit"
  | "quality";

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
  fit: "Fit to the approved requirements (decision model)",
  quality: "Overall quality (decision model)",
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
  /** The decision-model judge, when one is assigned. Numbers and labels only. */
  judge: JudgeView | null;
}

/** One judged part: a card, the persona, a lorebook or the opening. */
export interface JudgePartView {
  where: string;
  /** Lowest of all answers below; the part passes when it is above the threshold. */
  score: number;
  pass: boolean;
  /** Probability that each approved requirement holds. */
  fit: Array<{ label: string; p: number }>;
  /** Quality level 0 to 4, scaled to 0 to 1. */
  quality: number;
  /** An earlier, better-scored version was kept instead of the last rewrite. */
  restored: boolean;
}

export interface JudgeView {
  model: string;
  threshold: number;
  maxRounds: number;
  /** Fix round the scores belong to (0 = before any fix). */
  rounds: Array<{ round: number; passed: number; total: number; lowest: number; mean: number }>;
  parts: JudgePartView[];
}
