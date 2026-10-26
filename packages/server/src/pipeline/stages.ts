import type { AdventurePackage, CardDraft, LorebookDraft, Requirements } from "@adv/shared";
import type { Embedder } from "../generation/embeddings.ts";
import type { Decider } from "../generation/decisions.ts";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { PortraitSettings } from "@adv/shared";
import type { ImageGenerator } from "../generation/images.ts";
import { GenerationError } from "../generation/text.ts";
import { portraitPrompt, portraitSettingsKey, savePortrait, type PortraitOutput, type PortraitSubject } from "./portraits.ts";
import { runAudit } from "../audit/audit.ts";
import type { AuditOutput } from "../audit/units.ts";
import { adventurePackageSchema, lorebookEntryDraftSchema } from "@adv/shared";
import type { TextGenerator } from "../generation/text.ts";
import { validatePackage, type PackageIssue } from "../marinara/validate.ts";
import {
  cardOutputSchema,
  cluesSchema,
  factsSchema,
  LOREBOOK_KEYS,
  lorebookOutputSchema,
  openingSchema,
  personaOutputSchema,
  planSchema,
  type CardOutput,
  type Clues,
  type Facts,
  type LorebookKey,
  type LorebookOutput,
  type Opening,
  type Plan,
  titleSchema,
  type TitleOutput,
} from "./schemas.ts";
import { cardPrompt, cluesPrompt, factsPrompt, lorebookPrompt, narrativeVoiceEntry, openingPrompt, personaPrompt, planPrompt, titlePrompt } from "./prompts.ts";
import { z } from "zod";
import { scaleTargets, wordCount } from "./scale.ts";

export interface StageContext {
  projectId: string;
  title: string;
  requirements: Requirements;
  text: TextGenerator;
  repairAttempts: number;
  /** Output of a finished dependency. */
  output<T>(stageId: string): T;
  /** The stage's own last output, if any, while it runs again. */
  previousOutput<T>(stageId: string): T | null;
  has(stageId: string): boolean;
  /**
   * Audit fix notes for a stage, oldest first, and its previous output when only the notes changed
   * since that output was written (then the stage edits it instead of starting over).
   */
  revision(stageId: string): { notes: Array<{ round: number; note: string }>; player: PlayerNotes; previous: unknown };
  /** Titles the player replaced; the title stage avoids them. */
  rejectedTitles: string[];
  embedder: Embedder | null;
  decider: Decider | null;
  judgeThreshold: number;
  images: ImageGenerator | null;
  portraits: { settings: PortraitSettings; dir: string };
}

/** The player's change requests: new since the stage last ran, and earlier ones already applied. */
export interface PlayerNotes {
  now: string[];
  earlier: string[];
}

export interface PortraitOptions {
  settings: PortraitSettings;
  /** An image model is assigned. */
  available: boolean;
}

export interface StageDef {
  id: string;
  /** Spoiler-free label for the progress view. */
  label: string;
  deps: string[];
  /** Bump when a code-only stage changes behaviour, so finished projects re-run it. */
  version?: string;
  run(ctx: StageContext): Promise<unknown>;
  /** Spoiler-free one-line result, e.g. "62 facts". */
  summary(output: unknown): string;
}

const KICKOFF = [{ role: "user" as const, content: "Produce the JSON now." }];

function llmStage<S extends z.ZodType>(
  ctx: StageContext,
  purpose: string,
  schema: S,
  system: string,
  check?: (value: z.infer<S>) => string[],
): Promise<z.infer<S>> {
  const { notes, player, previous } = ctx.revision(purpose);
  const revised = notes.length || player.now.length || player.earlier.length ? `${system}\n\n${revisionBlock(notes, previous, player)}` : system;
  return ctx.text.generateJson(schema, { projectId: ctx.projectId, purpose, system: revised, messages: KICKOFF }, ctx.repairAttempts, check);
}

/**
 * Fixes edit the previous version when possible. Regenerating a whole lorebook to fix one entry
 * produced new problems every round (first real audit: no convergence after two rounds).
 */
export function revisionBlock(
  notes: Array<{ round: number; note: string }>,
  previous: unknown,
  player: PlayerNotes = { now: [], earlier: [] },
): string {
  const latest = notes.length ? Math.max(...notes.map((n) => n.round)) : 0;
  // A new player request is what this run is for; audit notes from before it are already applied.
  const byPlayer = player.now.length > 0;
  const now = byPlayer ? [] : notes.filter((n) => n.round === latest).map((n) => `- ${n.note}`);
  const earlier = notes.filter((n) => byPlayer || n.round !== latest).map((n) => `- ${n.note}`);
  const playerNow = player.now.map((n) => `- ${n}`);
  const playerEarlier = player.earlier.map((n) => `- ${n}`);
  const playerIntro = `The player asked for this change without reading the adventure. Do it in the spirit of the request, keep the story consistent with everything else you were given, and never address the player or mention the request in the output.`;
  if (previous) {
    const keep = [...earlier, ...playerEarlier];
    return `REVISION of your previous output, ${byPlayer ? "at the player's request" : "after a quality audit"}.
Return the COMPLETE JSON again, changing ONLY what the ${byPlayer ? "request" : "notes"} below require${byPlayer ? "s" : ""}. Keep every other entry and field exactly as it was: same keys, same names, same wording, same order. Do not rewrite, merge or reorder anything the ${byPlayer ? "request does" : "notes do"} not mention.
${byPlayer ? `${playerIntro}\nChange now:\n${playerNow.join("\n")}` : `Fix now:\n${now.join("\n")}`}${keep.length ? `\nAlready fixed in earlier revisions (keep them fixed):\n${keep.join("\n")}` : ""}

PREVIOUS OUTPUT
${JSON.stringify(previous)}`;
  }
  const blocks: string[] = [];
  if (notes.length) blocks.push(`NOTES from a quality audit of an earlier version. Make sure these problems do not occur:\n${[...now, ...earlier].join("\n")}`);
  if (playerNow.length || playerEarlier.length) blocks.push(`REQUESTS from the player. ${playerIntro}\n${[...playerEarlier, ...playerNow].join("\n")}`);
  return blocks.join("\n\n");
}

/** Stages the player may send a change request to: everything written by the text model. */
export const NOTE_STAGE = /^(plan|facts|clues|card:[a-z0-9-]+|persona|lorebook:[a-z]+|opening|title)$/;
export const MAX_PLAYER_NOTE = 1000;

/** Stages the audit may send fix notes to: renderings only. Plan and facts would cascade into everything. */
export const FIXABLE_STAGE = /^(card:[a-z0-9-]+|persona|lorebook:[a-z]+|opening)$/;

// ── Code checks (spec §12: structure is checked by code) ──

export function checkPlan(plan: Plan, requirements: Requirements): string[] {
  const maxCards = requirements.maxNpcCards;
  const t = scaleTargets(requirements);
  const problems: string[] = [];
  const locations = plan.entities.filter((e) => e.type === "location").length;
  const minor = plan.entities.filter((e) => e.type === "character" && !e.isCard).length;
  if (plan.entities.length < t.entities) problems.push(`only ${plan.entities.length} entities; a ${requirements.scale.length} adventure needs at least ${t.entities}`);
  if (locations < t.locations) problems.push(`only ${locations} locations; add at least ${t.locations - locations} more`);
  if (minor < t.minorCharacters) problems.push(`only ${minor} minor characters without cards; add at least ${t.minorCharacters - minor} more`);
  const keys = new Set<string>();
  for (const e of plan.entities) {
    if (keys.has(e.key)) problems.push(`entity key "${e.key}" is used twice`);
    keys.add(e.key);
    if (e.isCard && e.type !== "character") problems.push(`"${e.key}" has isCard but is not a character`);
  }
  const cards = plan.entities.filter((e) => e.isCard);
  if (cards.length === 0) problems.push("no entity has isCard=true");
  if (cards.length > maxCards) problems.push(`${cards.length} card characters exceed the limit of ${maxCards}`);
  if (!cards.some((c) => c.key === plan.openingCardKey)) problems.push("openingCardKey must be one of the isCard characters");
  if (plan.truth.culprit && !keys.has(plan.truth.culprit)) problems.push("truth.culprit is not an entity key");
  return problems;
}

export function checkFacts(facts: Facts, plan: Plan, requirements: Requirements): string[] {
  const t = scaleTargets(requirements);
  const problems: string[] = [];
  const n = facts.facts.length;
  if (n < t.facts[0]) problems.push(`only ${n} facts; a ${requirements.scale.length} adventure needs ${t.facts[0]}-${t.facts[1]} (cover places, people, the world and the truth in concrete detail)`);
  for (const card of plan.entities.filter((e) => e.isCard)) {
    const own = facts.facts.filter((f) => f.holder === card.key && (f.layer === "belief" || f.layer === "claim")).length;
    if (own < t.perspectivesPerCard) {
      problems.push(`card character "${card.key}" holds ${own} beliefs/claims; give them at least ${t.perspectivesPerCard} (alibis, half-truths, lies, wrong guesses)`);
    }
  }
  const entities = new Set(plan.entities.map((e) => e.key));
  const cards = new Set(plan.entities.filter((e) => e.isCard).map((e) => e.key));
  const ids = new Set<string>();
  for (const f of facts.facts) {
    if (ids.has(f.id)) problems.push(`fact id ${f.id} is used twice`);
    ids.add(f.id);
  }
  for (const f of facts.facts) {
    if (!entities.has(f.subject)) problems.push(`${f.id}: subject "${f.subject}" is not an entity key`);
    if (f.holder && !entities.has(f.holder)) problems.push(`${f.id}: holder "${f.holder}" is not an entity key`);
    if ((f.layer === "belief" || f.layer === "claim") && !f.holder) problems.push(`${f.id}: a ${f.layer} needs a holder`);
    if (f.contradicts && !ids.has(f.contradicts)) problems.push(`${f.id}: contradicts unknown fact ${f.contradicts}`);
    if (f.home.kind === "card" && !cards.has(f.home.card)) problems.push(`${f.id}: home card "${f.home.card}" is not a card character`);
  }
  const subjects = new Set(facts.facts.map((f) => f.subject));
  for (const e of plan.entities) if (!subjects.has(e.key)) problems.push(`entity "${e.key}" has no facts`);
  return problems;
}

export function checkClues(clues: Clues, plan: Plan, facts: Facts): string[] {
  const problems: string[] = [];
  const entities = new Set(plan.entities.map((e) => e.key));
  const factIds = new Set(facts.facts.map((f) => f.id));
  if (clues.conclusions.length === 0) problems.push("a mystery needs at least one conclusion");
  for (const c of clues.conclusions) {
    const paths = clues.clues.filter((k) => k.conclusionId === c.id);
    const places = new Set(paths.map((k) => k.where));
    if (paths.length < 2 || places.size < 2) problems.push(`conclusion ${c.id} needs clues in at least two different places`);
  }
  for (const k of clues.clues) {
    if (!clues.conclusions.some((c) => c.id === k.conclusionId)) problems.push(`clue ${k.id} points to unknown conclusion ${k.conclusionId}`);
    if (!entities.has(k.where)) problems.push(`clue ${k.id}: "${k.where}" is not an entity key`);
    if (k.factId && !factIds.has(k.factId)) problems.push(`clue ${k.id}: unknown fact ${k.factId}`);
  }
  return problems;
}

/**
 * Clue entries by place: each clue must surface where it is found, and no entry may hold clues
 * from several places (the first real audit found one entry gathering five places' clues).
 */
export function checkClueEntries(out: LorebookOutput, clues: Clues, plan: Plan): string[] {
  const problems: string[] = [];
  const entryOf = new Map<string, LorebookOutput["entries"][number]>();
  for (const e of out.entries) for (const id of e.factIds) entryOf.set(id, e);
  const placesByEntry = new Map<string, Set<string>>();
  for (const clue of clues.clues) {
    if (!clue.factId) continue;
    const entry = entryOf.get(clue.factId);
    const place = plan.entities.find((x) => x.key === clue.where);
    if (!entry || !place) continue;
    placesByEntry.set(entry.key, (placesByEntry.get(entry.key) ?? new Set()).add(place.key));
    const names = [place.name, ...place.aliases].map((n) => n.toLowerCase());
    const keyed = entry.keys.some((k) => names.some((n) => k.toLowerCase().includes(n) || n.includes(k.toLowerCase())));
    if (!keyed) problems.push(`entry "${entry.key}" holds clue ${clue.id} found at "${place.name}" but has no key for ${place.name}; key it on the place where the clue is found`);
  }
  for (const [entryKey, places] of placesByEntry) {
    if (places.size > 1) problems.push(`entry "${entryKey}" mixes clues from ${places.size} places (${[...places].join(", ")}); split it into one entry per place`);
  }
  return problems;
}

export function checkLorebook(out: LorebookOutput, expectedFacts: string[], cardKeys: Set<string>, requirements: Requirements): string[] {
  const t = scaleTargets(requirements);
  const problems: string[] = [];
  const keyed = out.entries.filter((e) => e.type !== "constant");
  const thin = keyed.filter((e) => wordCount(e.content) < t.entryWords);
  if (thin.length > 0) {
    problems.push(`${thin.length} entries are under ${t.entryWords} words (${thin.map((e) => e.key).join(", ")}); expand them with concrete, playable detail`);
  }
  const sticky = out.entries.filter((e) => (e.sticky ?? 0) > 0);
  if (sticky.length > Math.max(1, Math.floor(out.entries.length / 4))) {
    problems.push(`${sticky.length} of ${out.entries.length} entries are sticky; keep sticky only on the few entries that must stay in view (at most one in four)`);
  }
  const covered = new Set(out.entries.flatMap((e) => e.factIds));
  const missing = expectedFacts.filter((id) => !covered.has(id));
  if (missing.length) problems.push(`facts not rendered into any entry: ${missing.join(", ")}`);
  const keys = new Set<string>();
  for (const e of out.entries) {
    if (keys.has(e.key)) problems.push(`entry key "${e.key}" is used twice`);
    keys.add(e.key);
    if (e.type !== "constant" && e.keys.length === 0) problems.push(`entry "${e.key}" is not constant and has no keys`);
    for (const k of e.privateTo) if (!cardKeys.has(k)) problems.push(`entry "${e.key}": privateTo "${k}" is not a card key`);
    for (const k of e.keys) if (k.trim().length <= 2) problems.push(`entry "${e.key}": key "${k}" is too short`);
  }
  return problems;
}

// ── Stage registry ──

const plural = (n: number, word: string) =>
  `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

export function buildStages(requirements: Requirements, plan: Plan | null, portraits?: PortraitOptions): StageDef[] {
  const stages: StageDef[] = [
    {
      id: "plan",
      label: "Truth, cast and world plan",
      deps: [],
      run: (ctx) => llmStage(ctx, "plan", planSchema, planPrompt(ctx.requirements), (p) => checkPlan(p, ctx.requirements)),
      summary: (o) => {
        const p = o as Plan;
        return `${plural(p.entities.filter((e) => e.isCard).length, "card character")}, ${plural(p.entities.length, "entity")}`;
      },
    },
  ];
  if (!plan) return stages;

  const cards = plan.entities.filter((e) => e.isCard);
  const cardKeys = new Set(cards.map((c) => c.key));

  stages.push({
    id: "facts",
    label: "Fact registry",
    deps: ["plan"],
    run: (ctx) => {
      const p = ctx.output<Plan>("plan");
      return llmStage(ctx, "facts", factsSchema, factsPrompt(ctx.requirements, p), (f) => checkFacts(f, p, ctx.requirements));
    },
    summary: (o) => plural((o as Facts).facts.length, "fact"),
  });

  if (plan.isMystery) {
    stages.push({
      id: "clues",
      label: "Clues and solution paths",
      deps: ["plan", "facts"],
      run: (ctx) => {
        const p = ctx.output<Plan>("plan");
        const f = ctx.output<Facts>("facts");
        return llmStage(ctx, "clues", cluesSchema, cluesPrompt(ctx.requirements, p, f), (c) => checkClues(c, p, f));
      },
      summary: (o) => `${plural((o as Clues).conclusions.length, "conclusion")}, ${plural((o as Clues).clues.length, "clue")}`,
    });
  }

  for (const card of cards) {
    stages.push({
      id: `card:${card.key}`,
      label: `Character card: ${card.name}`,
      deps: ["plan", "facts"],
      run: (ctx) => {
        const p = ctx.output<Plan>("plan");
        const all = ctx.output<Facts>("facts").facts;
        const own = all.filter((f) => f.home.kind === "card" && f.home.card === card.key);
        const context = all.filter((f) => f.subject === card.key && !own.includes(f));
        return llmStage(ctx, `card:${card.key}`, cardOutputSchema, cardPrompt(ctx.requirements, p, card, own, context));
      },
      summary: () => `card for ${card.name}`,
    });
  }

  if (requirements.protagonist.mode === "new") {
    stages.push({
      id: "persona",
      label: "Your persona",
      deps: ["plan"],
      run: (ctx) => llmStage(ctx, "persona", personaOutputSchema, personaPrompt(ctx.requirements, ctx.output<Plan>("plan"))),
      summary: (o) => `persona ${(o as { name: string }).name}`,
    });
  }

  for (const lb of LOREBOOK_KEYS) {
    const deps = ["plan", "facts", ...(lb === "plot" && plan.isMystery ? ["clues"] : [])];
    stages.push({
      id: `lorebook:${lb}`,
      label: `Lorebook: ${lb[0]!.toUpperCase()}${lb.slice(1)}`,
      deps,
      run: async (ctx) => {
        const p = ctx.output<Plan>("plan");
        const facts = ctx.output<Facts>("facts").facts.filter((f) => f.home.kind === "lorebook" && f.home.lorebook === lb);
        if (facts.length === 0) return { entries: [] } satisfies LorebookOutput;
        const clues = lb === "plot" && ctx.has("clues") ? ctx.output<Clues>("clues") : null;
        return llmStage(ctx, `lorebook:${lb}`, lorebookOutputSchema, lorebookPrompt(ctx.requirements, p, lb, facts, clues), (o) => [
          ...checkLorebook(o, facts.map((f) => f.id), cardKeys, ctx.requirements),
          ...(clues ? checkClueEntries(o, clues, p) : []),
        ]);
      },
      // Plot 2: clue entries by place (prompt + check). Only Plot re-runs for existing projects.
      ...(lb === "plot" ? { version: "2" } : {}),
      summary: (o) => plural((o as LorebookOutput).entries.length, "entry"),
    });
  }

  stages.push({
    id: "opening",
    label: "Opening scene, teaser and Secret Plot",
    deps: ["plan", "facts", `card:${plan.openingCardKey}`],
    run: (ctx) => {
      const p = ctx.output<Plan>("plan");
      const card = ctx.output<CardOutput>(`card:${p.openingCardKey}`);
      return llmStage(ctx, "opening", openingSchema, openingPrompt(ctx.requirements, p, card, ctx.output<Facts>("facts")));
    },
    summary: () => "teaser, opening message and Secret Plot seed",
  });

  stages.push({
    id: "assemble",
    label: "Assemble and validate the package",
    deps: stages.map((s) => s.id),
    // 2: whole-word matching for short keys.
    version: "2",
    run: async (ctx) => assemble(ctx),
    summary: (o) => {
      const issues = (o as AssembleOutput).issues;
      const warnings = issues.filter((i) => i.severity === "warning").length;
      return `package ready, ${plural(warnings, "warning")}`;
    },
  });

  stages.push({
    id: "audit",
    label: "Quality audit",
    // 2: clue check honours selective entries' secondary keys.
    version: "2",
    deps: ["assemble", "plan", "facts", ...(plan.isMystery ? ["clues"] : [])],
    run: (ctx) => {
      const p = ctx.output<Plan>("plan");
      const assembled = ctx.output<AssembleOutput>("assemble");
      return runAudit({
        projectId: ctx.projectId,
        requirements: ctx.requirements,
        pkg: assembled.package,
        issues: assembled.issues,
        plan: p,
        facts: ctx.output<Facts>("facts"),
        clues: ctx.has("clues") ? ctx.output<Clues>("clues") : null,
        targets: fixTargets(p, assembled.package),
        text: ctx.text,
        embedder: ctx.embedder,
        decider: ctx.decider,
        judgeThreshold: ctx.judgeThreshold,
        repairAttempts: ctx.repairAttempts,
      });
    },
    summary: (o) => {
      const f = (o as AuditOutput).findings;
      return f.length === 0 ? "no findings" : `${plural(f.length, "finding")} (${f.filter((x) => x.severity === "major").length} major)`;
    },
  });

  // The title comes after the audit and nothing depends on it: a new title never re-assembles or
  // re-audits the package. It is applied to the package on export and push.
  stages.push({
    id: "title",
    label: "Adventure title",
    deps: ["plan", "opening"],
    run: async (ctx) => {
      const plan = ctx.output<Plan>("plan");
      const teaser = ctx.output<Opening>("opening").teaser;
      // The title reads only the requirements, plan and teaser. Keep it when none changed, so an audit fix
      // or a change request to the opening scene does not rename the adventure.
      const basedOn = createHash("sha256").update(JSON.stringify([ctx.requirements, plan, teaser, ctx.title, ctx.rejectedTitles])).digest("hex");
      const previous = ctx.previousOutput<TitleOutput & { basedOn?: string }>("title");
      if (previous?.basedOn === basedOn && ctx.revision("title").player.now.length === 0) return previous;
      const out = await llmStage(
        ctx,
        "title",
        titleSchema,
        titlePrompt(ctx.requirements, plan, teaser, ctx.title, ctx.rejectedTitles),
        (o) => (o.title.toLowerCase() === ctx.title.trim().toLowerCase() ? ["The title repeats the working label; write a new title."] : []),
      );
      return { ...out, basedOn };
    },
    summary: (o) => `“${(o as TitleOutput).title}”`,
  });

  // Portraits come last and stand alone: re-rendering one never re-assembles or re-audits the package.
  if (portraits?.settings.enabled && portraits.available) {
    const version = portraitSettingsKey(portraits.settings);
    for (const card of cards) {
      stages.push({
        id: `avatar:${card.key}`,
        label: `Portrait: ${card.name}`,
        deps: [`card:${card.key}`],
        version,
        run: (ctx) => {
          const c = ctx.output<CardOutput>(`card:${card.key}`);
          return renderPortrait(ctx, `avatar:${card.key}`, card.key, { name: card.name, appearance: c.appearance, imageAppearance: c.imageAppearance });
        },
        summary: portraitSummary,
      });
    }
    if (requirements.protagonist.mode === "new") {
      stages.push({
        id: "avatar:persona",
        label: "Portrait: your persona",
        deps: ["persona"],
        version,
        run: (ctx) => {
          const p = ctx.output<{ name: string; appearance: string }>("persona");
          return renderPortrait(ctx, "avatar:persona", "persona", { name: p.name, appearance: p.appearance });
        },
        summary: portraitSummary,
      });
    }
  }

  return stages;
}

// ── Portraits ──

export interface AvatarOutput extends PortraitOutput {
  /** Vision check against Appearance and style: passed, kept after a failed retry, or not possible. */
  check: "match" | "mismatch" | "unchecked";
}

const portraitSummary = (o: unknown) => {
  const a = o as AvatarOutput;
  return `${a.width}×${a.height} portrait, ${a.check === "match" ? "matches its description" : a.check === "mismatch" ? "may not match its description" : "not checked against its description"}`;
};

const portraitCheckSchema = z.object({
  matches: z.boolean(),
  problems: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
});

/**
 * Generate, crop and check one portrait (spec §12.8). A vision review compares it with the
 * appearance and the style; on a mismatch the portrait is redrawn once with the problems named.
 * When the text model cannot see images, the portrait is kept and marked unchecked.
 */
async function renderPortrait(ctx: StageContext, stageId: string, fileKey: string, subject: PortraitSubject): Promise<AvatarOutput> {
  if (!ctx.images) throw new GenerationError("No image model is assigned.", "not-assigned");
  const basePrompt = portraitPrompt(ctx.requirements, ctx.portraits.settings, subject);
  let prompt = basePrompt;
  let check: AvatarOutput["check"] = "unchecked";
  let image = await ctx.images.portrait(prompt, ctx.projectId, stageId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const thumb = await sharp(image.png).resize(512, 512).jpeg({ quality: 80 }).toBuffer();
    let verdict: z.infer<typeof portraitCheckSchema>;
    try {
      verdict = await ctx.text.generateJson(
        portraitCheckSchema,
        {
          projectId: ctx.projectId,
          purpose: `${stageId}:check`,
          system: `Stage: portrait-check
You check a generated character portrait against its description before it goes on a character card.
Character: ${subject.name}
Appearance: ${subject.imageAppearance?.trim() || subject.appearance}
Requested style: ${basePrompt.split("\n")[1]}
It matches when the visible features fit the description (apparent age, build, hair, skin or species, clothing, distinctive marks), it shows one person in the requested style, and it has no text or watermark. Small artistic liberties are fine.
Reply with ONLY JSON: {"matches": true, "problems": ["short, concrete differences"]}`,
          messages: [{ role: "user", content: "Check this portrait.", images: [`data:image/jpeg;base64,${thumb.toString("base64")}`] }],
        },
        ctx.repairAttempts,
      );
    } catch {
      // No vision on this model, or the check failed: keep the portrait, say it was not checked.
      check = "unchecked";
      break;
    }
    if (verdict.matches) {
      check = "match";
      break;
    }
    check = "mismatch";
    if (attempt === 1) break;
    prompt = `${basePrompt}\nThe previous attempt got these wrong; fix them: ${verdict.problems.join("; ")}.`;
    image = await ctx.images.portrait(prompt, ctx.projectId, stageId);
  }
  const saved = await savePortrait(ctx.portraits.dir, ctx.projectId, fileKey, image.png);
  return { ...saved, width: image.width, height: image.height, check };
}

/** Stages the audit can name as targets, with labels that show only what the player may see. */
export function fixTargets(plan: Plan, pkg: AdventurePackage): Map<string, string> {
  const targets = new Map<string, string>();
  for (const e of plan.entities.filter((x) => x.isCard)) targets.set(`card:${e.key}`, `Card: ${e.name}`);
  if (pkg.persona) targets.set("persona", "Persona");
  for (const lb of pkg.lorebooks) targets.set(`lorebook:${lb.key}`, `Lorebook: ${lb.name}`);
  targets.set("opening", "Opening scene and teaser");
  return targets;
}

// ── Assembly (code only) ──

export interface AssembleOutput {
  package: AdventurePackage;
  issues: PackageIssue[];
}

export class PackageInvalidError extends Error {
  constructor(readonly issues: PackageIssue[]) {
    super(`The assembled package has ${issues.filter((i) => i.severity === "error").length} validation error(s).`);
  }
}

const LOREBOOK_META: Record<LorebookKey, { name: string; category: LorebookDraft["category"]; tokenBudget: number }> = {
  world: { name: "World", category: "world", tokenBudget: 2048 },
  characters: { name: "Characters", category: "npc", tokenBudget: 2048 },
  plot: { name: "Plot", category: "uncategorized", tokenBudget: 3072 },
};

/** Keys of this length or less match inside longer words ("Rook" in "Brooklyn") unless whole-word matching is on. */
export const SHORT_KEY_LENGTH = 5;

/**
 * Models often skip whole-word matching for short keys such as first names, even when told to
 * (second real run: 14 of 36 entries). Turning it on is safe here: whole-word matching still
 * matches multi-word keys, only no longer inside other words. Regex keys are left alone.
 */
export function withWholeWordsForShortKeys<E extends { keys: string[]; secondaryKeys: string[]; useRegex: boolean; matchWholeWords: boolean }>(entry: E): E {
  if (entry.useRegex || entry.matchWholeWords) return entry;
  const short = [...entry.keys, ...entry.secondaryKeys].some((k) => k.trim().length <= SHORT_KEY_LENGTH);
  return short ? { ...entry, matchWholeWords: true } : entry;
}

/** The package under its generated title: the package title and the lorebook names that carry it. */
export function retitle(out: AssembleOutput, title: string): AssembleOutput {
  const pkg = out.package;
  if (pkg.title === title) return out;
  const prefix = `${pkg.title}: `;
  return {
    ...out,
    package: {
      ...pkg,
      title,
      lorebooks: pkg.lorebooks.map((lb) => (lb.name.startsWith(prefix) ? { ...lb, name: `${title}: ${lb.name.slice(prefix.length)}` } : lb)),
    },
  };
}

export function assemble(ctx: StageContext): AssembleOutput {
  const plan = ctx.output<Plan>("plan");
  const opening = ctx.output<Opening>("opening");
  const characters: CardDraft[] = plan.entities
    .filter((e) => e.isCard)
    .map((e) => {
      const card = ctx.output<CardOutput>(`card:${e.key}`);
      return {
        ...card,
        key: e.key,
        // The plan owns names; a card stage may not rename its character.
        name: e.name,
        alternateGreetings: [],
        // One shared opening: only the opening card greets (spec §6).
        firstMessage: e.key === plan.openingCardKey ? opening.openingMessage : card.firstMessage,
      };
    });

  const voice = narrativeVoiceEntry(ctx.requirements);
  const lorebooks = LOREBOOK_KEYS.map((key) => {
    const out = ctx.output<LorebookOutput>(`lorebook:${key}`);
    // The voice reminder rides in World as one short constant entry, ahead of everything else.
    if (key !== "world" || !voice) return { key, out };
    return {
      key,
      out: {
        entries: [
          lorebookEntryDraftSchema.parse({ key: "narrative-voice", name: "Narrative voice", type: "constant", order: 1, content: voice, noVector: true }),
          ...out.entries.filter((e) => e.key !== "narrative-voice"),
        ],
      },
    };
  })
    .filter(({ out }) => out.entries.length > 0)
    .map(({ key, out }) => ({
      key,
      name: `${ctx.title}: ${LOREBOOK_META[key].name}`,
      category: LOREBOOK_META[key].category,
      tokenBudget: LOREBOOK_META[key].tokenBudget,
      entries: out.entries.map(withWholeWordsForShortKeys),
    }));

  const pkg = adventurePackageSchema.parse({
    title: ctx.title,
    teaser: opening.teaser,
    maxNpcCards: ctx.requirements.maxNpcCards,
    characters,
    ...(ctx.has("persona") ? { persona: ctx.output("persona") } : {}),
    lorebooks,
    openingCardKey: plan.openingCardKey,
    secretPlot: opening.secretPlot,
  });
  const issues = validatePackage(pkg);
  if (issues.some((i) => i.severity === "error")) throw new PackageInvalidError(issues);
  return { package: pkg, issues };
}
