import { z } from "zod";

/**
 * What the player wants (spec §3). Only preferences live here, never plot: the interview must
 * not decide secrets, culprits or the ending. The one exception is `mustInclude`, for details
 * the player chose to impose themselves.
 */

const line = (max = 500) => z.string().trim().max(max).default("");

export const lengthSchema = z.enum(["one-shot", "short", "medium", "long"]);
export const violenceSchema = z.enum(["none", "mild", "moderate", "graphic"]);
export const romanceSchema = z.enum(["none", "background", "possible", "central"]);
export const sexualContentSchema = z.enum(["none", "fade-to-black", "explicit"]);
export const horrorSchema = z.enum(["none", "light", "strong"]);
export const povSchema = z.enum(["second", "third", "first"]);

export const requirementsSchema = z.object({
  /** The player's original pitch, kept verbatim (any language). */
  idea: z.string().trim().max(4000).default(""),
  genre: line(200),
  subgenres: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  tone: z.array(z.string().trim().min(1).max(100)).max(8).default([]),
  narration: z
    .object({
      pov: povSchema.default("second"),
      tense: z.enum(["present", "past"]).default("present"),
      style: line(500),
    })
    .prefault({}),
  setting: z
    .object({
      era: line(200),
      place: line(300),
      technology: line(300),
      supernatural: line(500),
      notes: line(1000),
    })
    .prefault({}),
  startingSituation: line(1500),
  protagonist: z
    .object({
      mode: z.enum(["existing", "new"]).default("new"),
      notes: line(1500),
    })
    .prefault({}),
  /** Upper limit of full NPC cards; the persona does not count (spec §4). */
  maxNpcCards: z.number().int().min(1).max(8).default(3),
  scale: z
    .object({
      length: lengthSchema.default("medium"),
      notes: line(500),
    })
    .prefault({}),
  content: z
    .object({
      violence: violenceSchema.default("moderate"),
      romance: romanceSchema.default("possible"),
      sexualContent: sexualContentSchema.default("fade-to-black"),
      horror: horrorSchema.default("light"),
      hardLimits: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
      notes: line(1000),
    })
    .prefault({}),
  visualStyle: line(500),
  /** Details the player imposed on purpose (may be plot). Never invented by the interviewer. */
  mustInclude: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});
export type Requirements = z.infer<typeof requirementsSchema>;
export type RequirementsInput = z.input<typeof requirementsSchema>;

/** Fields the interview should settle before offering a summary; everything else has a default. */
export const ESSENTIAL_FIELDS = ["genre", "tone", "setting.place", "setting.era", "startingSituation"] as const;

export function missingEssentials(r: Requirements): string[] {
  const missing: string[] = [];
  if (!r.genre) missing.push("genre");
  if (r.tone.length === 0) missing.push("tone");
  if (!r.setting.place) missing.push("setting.place");
  if (!r.setting.era) missing.push("setting.era");
  if (!r.startingSituation) missing.push("startingSituation");
  return missing;
}

export interface InterviewMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Assistant turns: the short questions asked. */
  questions: string[];
  createdAt: string;
}

export interface InterviewState {
  projectId: string;
  messages: InterviewMessage[];
  requirements: Requirements;
  /** Defaults the interviewer chose instead of asking; visible to the player. */
  assumptions: string[];
  missing: string[];
  readyForSummary: boolean;
  approvedAt: string | null;
  version: number;
}

export const interviewMessageInputSchema = z.object({ content: z.string().trim().min(1).max(4000) });

export const updateRequirementsSchema = z.object({
  requirements: requirementsSchema,
  assumptions: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
});
