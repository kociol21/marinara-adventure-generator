import type { AdventurePackage, CardDraft, LorebookDraft, Requirements } from "@adv/shared";
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
} from "./schemas.ts";
import { cardPrompt, cluesPrompt, factsPrompt, lorebookPrompt, narrativeVoiceEntry, openingPrompt, personaPrompt, planPrompt } from "./prompts.ts";
import type { z } from "zod";
import { scaleTargets, wordCount } from "./scale.ts";

export interface StageContext {
  projectId: string;
  title: string;
  requirements: Requirements;
  text: TextGenerator;
  repairAttempts: number;
  /** Output of a finished dependency. */
  output<T>(stageId: string): T;
  has(stageId: string): boolean;
}

export interface StageDef {
  id: string;
  /** Spoiler-free label for the progress view. */
  label: string;
  deps: string[];
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
  return ctx.text.generateJson(schema, { projectId: ctx.projectId, purpose, system, messages: KICKOFF }, ctx.repairAttempts, check);
}

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

export function buildStages(requirements: Requirements, plan: Plan | null): StageDef[] {
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
        return llmStage(ctx, `lorebook:${lb}`, lorebookOutputSchema, lorebookPrompt(ctx.requirements, p, lb, facts, clues), (o) =>
          checkLorebook(o, facts.map((f) => f.id), cardKeys, ctx.requirements),
        );
      },
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
    run: async (ctx) => assemble(ctx),
    summary: (o) => {
      const issues = (o as AssembleOutput).issues;
      const warnings = issues.filter((i) => i.severity === "warning").length;
      return `package ready, ${plural(warnings, "warning")}`;
    },
  });

  return stages;
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
      entries: out.entries,
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
