import { z } from "zod";

/**
 * The adventure package as the generator produces it, before mapping to Marinara's formats.
 * Field names follow the spec (Description, Personality, Backstory, …), not Marinara's storage.
 * Keys are stable slugs used for cross-references inside the package; Marinara ids never appear here.
 */

const key = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and dashes");

const text = (max: number) => z.string().max(max);

export const cardDraftSchema = z.object({
  key,
  name: z.string().trim().min(1).max(100),
  /** Shown in Marinara's library; must not hint at secrets. */
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  description: text(8000),
  personality: text(8000),
  backstory: text(12000),
  appearance: text(4000),
  /** Short image tags; used for image prompts instead of Appearance when set. */
  imageAppearance: text(1000).optional(),
  scenario: text(4000),
  firstMessage: text(8000),
  alternateGreetings: z.array(text(8000)).max(10).default([]),
  /** Sample exchanges separated by <START>, using {{user}} and {{char}}. */
  exampleDialogue: text(8000),
  /** PNG/JPEG/WebP data URL. */
  avatar: z.string().startsWith("data:image/").optional(),
});
export type CardDraft = z.infer<typeof cardDraftSchema>;

export const personaDraftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  description: text(8000),
  personality: text(8000),
  backstory: text(12000),
  appearance: text(4000),
  scenario: text(4000),
  exampleDialogue: text(8000).default(""),
  avatar: z.string().startsWith("data:image/").optional(),
});
export type PersonaDraft = z.infer<typeof personaDraftSchema>;

export const entryTypeSchema = z.enum(["normal", "constant", "selective"]);
export const selectiveLogicSchema = z.enum(["and_any", "and_all", "not_any", "not_all"]);
export const entryPositionSchema = z.enum(["before_chat", "after_chat", "at_depth", "outlet"]);

export const lorebookEntryDraftSchema = z.object({
  key,
  name: z.string().trim().min(1).max(200),
  content: text(20000),
  /** Read only by Marinara's Knowledge Router agent; never sent as content. */
  description: text(1000).default(""),
  type: entryTypeSchema.default("normal"),
  keys: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  secondaryKeys: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  selectiveLogic: selectiveLogicSchema.default("and_any"),
  matchWholeWords: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
  useRegex: z.boolean().default(false),
  position: entryPositionSchema.default("before_chat"),
  depth: z.number().int().min(0).max(1000).default(4),
  role: z.enum(["system", "user", "assistant"]).default("system"),
  outletName: z.string().max(100).default(""),
  /** Lower loads first and survives budget trimming. */
  order: z.number().int().min(-10000).max(10000).default(100),
  /** null = always (100%). */
  probability: z.number().min(0).max(100).nullable().default(null),
  sticky: z.number().int().min(0).max(1000).nullable().default(null),
  cooldown: z.number().int().min(0).max(1000).nullable().default(null),
  delay: z.number().int().min(0).max(10000).nullable().default(null),
  ephemeral: z.number().int().min(0).max(1000).nullable().default(null),
  /** null = inherit the lorebook's scan depth; 0 = whole chat. */
  scanDepth: z.number().int().min(0).max(1000).nullable().default(null),
  group: z.string().max(100).default(""),
  groupWeight: z.number().min(0).max(1000).nullable().default(null),
  /** Let this entry's content trigger other entries when the lorebook scans recursively. */
  recursion: z.boolean().default(false),
  /** Exclude from semantic (vector) matching. */
  noVector: z.boolean().default(false),
  /**
   * Card keys whose replies may see this entry (private knowledge). Exported as a
   * character-tag filter, because character-id filters do not survive file import.
   */
  privateTo: z.array(key).default([]),
  decision: z
    .object({ mode: z.enum(["require", "trigger"]), statement: z.string().trim().min(1).max(500) })
    .nullable()
    .default(null),
  /** Free label for organisation; does not affect activation. */
  tag: z.string().max(100).default(""),
  /** Fact-registry ids this entry was rendered from (M4). */
  factIds: z.array(z.string()).default([]),
});
export type LorebookEntryDraft = z.infer<typeof lorebookEntryDraftSchema>;
export type LorebookEntryDraftInput = z.input<typeof lorebookEntryDraftSchema>;

export const lorebookDraftSchema = z.object({
  key,
  name: z.string().trim().min(1).max(200),
  description: text(2000).default(""),
  category: z.enum(["world", "character", "npc", "spellbook", "uncategorized"]).default("uncategorized"),
  scanDepth: z.number().int().min(0).max(1000).default(2),
  tokenBudget: z.number().int().min(0).max(1_000_000).default(2048),
  entryLimit: z.number().int().min(1).max(1000).default(100),
  recursiveScanning: z.boolean().default(false),
  maxRecursionDepth: z.number().int().min(1).max(10).default(3),
  vectors: z
    .object({
      enabled: z.boolean(),
      queryMessages: z.number().int().min(0).max(100),
      scoreThreshold: z.number().min(0).max(1),
      maxResults: z.number().int().min(1).max(100),
    })
    .default({ enabled: false, queryMessages: 10, scoreThreshold: 0.3, maxResults: 10 }),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  entries: z.array(lorebookEntryDraftSchema).max(2000),
});
export type LorebookDraft = z.infer<typeof lorebookDraftSchema>;
export type LorebookDraftInput = z.input<typeof lorebookDraftSchema>;

export const secretPlotSeedSchema = z.object({
  description: text(4000),
  protagonistArc: text(2000),
  characterArc: text(2000).optional(),
  sceneDirections: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  pacing: z.string().max(200).optional(),
});
export type SecretPlotSeed = z.infer<typeof secretPlotSeedSchema>;

export const adventurePackageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Spoiler-free teaser; the only story text the player sees before playing. */
  teaser: text(2000),
  maxNpcCards: z.number().int().min(1).max(20),
  characters: z.array(cardDraftSchema).min(1).max(20),
  /** Present when the user ordered a new persona. */
  persona: personaDraftSchema.optional(),
  lorebooks: z.array(lorebookDraftSchema).max(20),
  /** Card whose First Message opens the shared scene. */
  openingCardKey: key,
  /** Pushed through the API only; never written into export files. */
  secretPlot: secretPlotSeedSchema.optional(),
});
export type AdventurePackage = z.infer<typeof adventurePackageSchema>;
export type AdventurePackageInput = z.input<typeof adventurePackageSchema>;
