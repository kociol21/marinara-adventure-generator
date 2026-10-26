import type { AdventurePackage, Requirements } from "@adv/shared";
import type { DecisionAnswer, DecisionQuestion } from "../connections/adapters.ts";
import type { AuditFinding } from "./units.ts";

/**
 * The decision-model judge: every part the pipeline can rewrite is scored against the approved
 * requirements (yes/no probabilities) and for overall quality (a described 0-4 scale). Questions
 * and fix notes are built by code, so nothing the player should not see reaches the report.
 */

export interface JudgedPart {
  stage: string;
  where: string;
  /** Probability of a yes to each requirement question (asked so that yes is good). */
  fit: Array<{ label: string; question: string; p: number }>;
  /** Quality level 0-4 scaled to 0-1. */
  quality: number;
  /** Lowest of fit and quality. */
  score: number;
  /** Hash of the judge model, questions and text; an unchanged part keeps its score. */
  key?: string;
}

export interface JudgeOutput {
  model: string;
  threshold: number;
  parts: JudgedPart[];
}

interface Requirement {
  key: string;
  label: string;
  instructions: string;
}

const QUALITY_LEVELS = [
  "Unusable: broken, empty, contradictory or off-topic.",
  "Weak: generic or flat, with clear gaps or errors.",
  "Adequate: usable but bland, vague or uneven.",
  "Good: specific, vivid and coherent; ready for play.",
  "Excellent: distinctive, evocative and polished, with nothing left to fix.",
];
const QUALITY_TOP = QUALITY_LEVELS.length - 1;

const QUALITY_ASK: Record<"card" | "persona" | "lorebook" | "opening", string> = {
  card: "Rate this character card for a roleplay adventure run by an AI narrator: a distinct voice and motives, concrete detail, and material the narrator can use in play.",
  persona: "Rate this player persona for a roleplay adventure: a clear, playable character with concrete detail and a reason to be in the story.",
  lorebook: "Rate this lorebook for a roleplay adventure run by an AI narrator: entries that are concrete, non-repetitive and useful when they come up in play.",
  opening: "Rate this opening scene and teaser for a roleplay adventure: an engaging first scene that sets mood and situation and gives the player something to do.",
};

const list = (xs: string[]) => xs.join(", ");
const joinParts = (parts: Array<string | false>) => parts.filter(Boolean).join("; ");

/** Requirements every part is held to; only those the player actually set. */
function sharedRequirements(r: Requirements): Requirement[] {
  const out: Requirement[] = [];
  if (r.genre || r.subgenres.length) {
    out.push({
      key: "genre",
      label: "Genre",
      instructions: `Does this material fit the requested genre: ${joinParts([r.genre && r.genre, r.subgenres.length > 0 && `subgenres ${list(r.subgenres)}`])}?`,
    });
  }
  if (r.tone.length) out.push({ key: "tone", label: "Tone", instructions: `Does this material match the requested tone: ${list(r.tone)}?` });
  const s = r.setting;
  const setting = joinParts([s.era && `era: ${s.era}`, s.place && `place: ${s.place}`, s.technology && `technology: ${s.technology}`, s.supernatural && `supernatural: ${s.supernatural}`]);
  if (setting) out.push({ key: "setting", label: "Setting", instructions: `Is this material consistent with the requested setting (${setting})?` });
  const c = r.content;
  out.push({
    key: "content",
    label: "Content limits",
    instructions:
      `Does this material stay within the player's content limits: violence at most "${c.violence}", romance at most "${c.romance}", ` +
      `sexual content at most "${c.sexualContent}", horror at most "${c.horror}"` +
      (c.hardLimits.length ? `, and never any of: ${list(c.hardLimits)}` : "") +
      "? Material that never touches a topic stays within its limit.",
  });
  return out;
}

/** Text the judge reads for one part; the opening card's first message belongs to the opening. */
export function judgedParts(pkg: AdventurePackage, r: Requirements) {
  const shared = sharedRequirements(r);
  const parts: Array<{ stage: string; where: string; kind: keyof typeof QUALITY_ASK; state: unknown; requirements: Requirement[] }> = [];
  for (const card of pkg.characters) {
    const { avatar: _avatar, firstMessage, alternateGreetings, ...rest } = card as typeof card & { avatar?: string };
    const opening = card.key === pkg.openingCardKey;
    parts.push({
      stage: `card:${card.key}`,
      where: `Card: ${card.name}`,
      kind: "card",
      state: { characterCard: { ...rest, ...(opening ? {} : { firstMessage, alternateGreetings }) } },
      requirements: shared,
    });
  }
  if (pkg.persona) {
    const { avatar: _avatar, ...persona } = pkg.persona;
    const protagonist = r.protagonist.notes.trim()
      ? [{ key: "protagonist", label: "Player's character", instructions: `Does this persona match the player's own description of their character: ${r.protagonist.notes}?` }]
      : [];
    parts.push({ stage: "persona", where: "Persona", kind: "persona", state: { playerPersona: persona }, requirements: [...shared, ...protagonist] });
  }
  for (const lb of pkg.lorebooks) {
    // The narrative-voice entry is written by code, not by the stage being judged.
    const entries = lb.entries.filter((e) => e.key !== "narrative-voice").map((e) => ({ name: e.name, content: e.content }));
    if (entries.length === 0) continue;
    parts.push({ stage: `lorebook:${lb.key}`, where: `Lorebook: ${lb.name}`, kind: "lorebook", state: { lorebook: { name: lb.name, entries } }, requirements: shared });
  }
  const openingCard = pkg.characters.find((c) => c.key === pkg.openingCardKey);
  if (openingCard) {
    const n = r.narration;
    const voice = joinParts([n.style.trim() && `voice: ${n.style}`, n.inspirations.length > 0 && `in the manner of ${list(n.inspirations)}`]);
    const narration: Requirement = {
      key: "narration",
      label: "Narration",
      instructions: `Is the opening scene narrated in the ${n.pov} person and the ${n.tense} tense${voice ? ` (${voice})` : ""}?`,
    };
    const situation: Requirement[] = r.startingSituation.trim()
      ? [{ key: "start", label: "Starting situation", instructions: `Does the opening scene start from this situation: ${r.startingSituation}?` }]
      : [];
    parts.push({
      stage: "opening",
      where: "Opening scene and teaser",
      kind: "opening",
      state: { teaser: pkg.teaser, openingScene: openingCard.firstMessage },
      requirements: [...shared, narration, ...situation],
    });
  }
  return parts;
}

export function questionsFor(part: ReturnType<typeof judgedParts>[number]): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};
  for (const q of part.requirements) questions[q.key] = { type: "noul", instructions: q.instructions };
  questions.quality = { type: "score", instructions: QUALITY_ASK[part.kind], criteria: QUALITY_LEVELS };
  return questions;
}

/** Score answers may be a level index or carry per-level probabilities; both give a 0-1 value. */
export function qualityValue(answer: DecisionAnswer | undefined): number {
  if (answer?.type !== "score") return 0;
  return Math.min(1, Math.max(0, answer.score / QUALITY_TOP));
}

export function scorePart(part: ReturnType<typeof judgedParts>[number], answers: Record<string, DecisionAnswer>): JudgedPart {
  const fit = part.requirements.map((q) => {
    const a = answers[q.key];
    return { label: q.label, question: q.instructions, p: a?.type === "noul" ? a.noul : 0 };
  });
  const quality = qualityValue(answers.quality);
  return { stage: part.stage, where: part.where, fit, quality, score: Math.min(quality, ...fit.map((f) => f.p)) };
}

const pct = (x: number) => x.toFixed(2);

/** Major findings for parts at or below the threshold; the fix note names what fell short. */
export function judgeFindings(judge: JudgeOutput): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const part of judge.parts) {
    if (part.score > judge.threshold) continue;
    const failedFit = part.fit.filter((f) => f.p <= judge.threshold);
    const lowQuality = part.quality <= judge.threshold;
    const level = Math.round(part.quality * QUALITY_TOP);
    const below = [...failedFit.map((f) => `${f.label} (${pct(f.p)})`), ...(lowQuality ? [`Quality (${pct(part.quality)})`] : [])];
    const fix = [
      `A decision model checked this part against the approved requirements and for overall quality; it scored at or below ${pct(judge.threshold)} on: ${below.join(", ")}.`,
      ...failedFit.map((f) => `- ${f.label}: the answer to "${f.question}" must be a clear yes.`),
      ...(lowQuality
        ? [`- Quality was judged near level ${level} of ${QUALITY_TOP} ("${QUALITY_LEVELS[level]}"). Raise it to: "${QUALITY_LEVELS[QUALITY_TOP - 1]}"`]
        : []),
      "Keep every fact, name, clue, secret and relationship unchanged; improve only how this part is written.",
    ].join("\n");
    out.push({
      id: `judge:${part.stage}`,
      area: failedFit.length > 0 ? "fit" : "quality",
      severity: "major",
      source: "model",
      target: part.stage,
      where: part.where,
      summary: `Below the decision model's bar: ${below.join(", ")}.`,
      detail: fix,
      fix,
    });
  }
  return out;
}
