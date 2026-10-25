import { z } from "zod";
import { cardDraftSchema, lorebookEntryDraftSchema, personaDraftSchema, secretPlotSeedSchema } from "@adv/shared";

/**
 * Outputs of the generation stages. These hold the hidden story, so they never reach the UI
 * outside "Show spoilers"; status views only show the spoiler-free `summary` of each stage.
 */

const key = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and dashes");

export const LOREBOOK_KEYS = ["world", "characters", "plot"] as const;
export const lorebookKeySchema = z.enum(LOREBOOK_KEYS);
export type LorebookKey = z.infer<typeof lorebookKeySchema>;

// ── plan: the truth, the cast and the things in the world ──

export const entitySchema = z.object({
  key,
  type: z.enum(["character", "location", "organization", "item", "concept"]),
  name: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  /** What anyone in the world could know. Never secrets. */
  publicDescription: z.string().trim().min(1).max(1000),
  /** Function in the adventure (hidden). */
  role: z.string().trim().max(1000).default(""),
  /** Characters only: gets a full character card. */
  isCard: z.boolean().default(false),
});
export type Entity = z.infer<typeof entitySchema>;

export const planSchema = z.object({
  /** Hidden synopsis of the situation the player walks into. */
  premise: z.string().trim().min(1).max(4000),
  isMystery: z.boolean(),
  truth: z.object({
    summary: z.string().trim().min(1).max(4000),
    timeline: z.array(z.object({ when: z.string().trim().min(1).max(200), what: z.string().trim().min(1).max(1000) })).max(40),
    culprit: key.nullable().default(null),
    motive: z.string().max(1000).default(""),
    method: z.string().max(1000).default(""),
  }),
  entities: z.array(entitySchema).min(2).max(60),
  threads: z.array(z.object({ key, name: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(1500) })).max(12).default([]),
  openingCardKey: key,
});
export type Plan = z.infer<typeof planSchema>;

// ── facts: one home per fact (spec §11) ──

export const factHomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("card"),
    card: key,
    field: z.enum(["description", "personality", "backstory", "appearance", "scenario"]),
  }),
  z.object({ kind: z.literal("lorebook"), lorebook: lorebookKeySchema }),
]);

export const factSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^f[0-9]+$/, "Fact ids look like f1, f2, …"),
  subject: key,
  statement: z.string().trim().min(1).max(1000),
  /** Spec §9 layers: what is true, what someone believes, what someone claims, what is common knowledge. */
  layer: z.enum(["truth", "belief", "claim", "public"]),
  holder: key.nullable().default(null),
  /** For beliefs and claims that are wrong: the fact they contradict. */
  contradicts: z.string().nullable().default(null),
  secrecy: z.enum(["public", "hidden", "secret"]),
  home: factHomeSchema,
});
export type Fact = z.infer<typeof factSchema>;

export const factsSchema = z.object({ facts: z.array(factSchema).min(5).max(300) });
export type Facts = z.infer<typeof factsSchema>;

// ── clues: how a mystery can be solved, with redundancy (spec §9) ──

export const cluesSchema = z.object({
  conclusions: z
    .array(z.object({ id: z.string().min(1).max(20), statement: z.string().trim().min(1).max(1000), factIds: z.array(z.string()).default([]) }))
    .max(20),
  clues: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        conclusionId: z.string().min(1).max(20),
        where: key,
        how: z.string().trim().min(1).max(1000),
        factId: z.string().nullable().default(null),
      }),
    )
    .max(80),
  redHerrings: z
    .array(z.object({ id: z.string().min(1).max(20), statement: z.string().trim().min(1).max(1000), explanation: z.string().trim().min(1).max(1000) }))
    .max(10)
    .default([]),
});
export type Clues = z.infer<typeof cluesSchema>;

// ── renderings ──

export const cardOutputSchema = cardDraftSchema.omit({ key: true, avatar: true, alternateGreetings: true });
export type CardOutput = z.infer<typeof cardOutputSchema>;

export const personaOutputSchema = personaDraftSchema.omit({ avatar: true });

export const lorebookOutputSchema = z.object({
  entries: z.array(lorebookEntryDraftSchema.omit({ factIds: true }).extend({ factIds: z.array(z.string()).default([]) })).max(300),
});
export type LorebookOutput = z.infer<typeof lorebookOutputSchema>;

export const openingSchema = z.object({
  /** Spoiler-free teaser for the library and START-HERE. */
  teaser: z.string().trim().min(1).max(1200),
  /** The opening card's First Message; plays the shared starting scene. */
  openingMessage: z.string().trim().min(1).max(8000),
  secretPlot: secretPlotSeedSchema,
});
export type Opening = z.infer<typeof openingSchema>;
