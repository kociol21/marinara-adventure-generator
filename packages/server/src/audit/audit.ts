import { createHash } from "node:crypto";
import type { AdventurePackage, Requirements } from "@adv/shared";
import type { TextGenerator } from "../generation/text.ts";
import { GenerationError } from "../generation/text.ts";
import { cosine, type Embedder } from "../generation/embeddings.ts";
import type { Decider } from "../generation/decisions.ts";
import { judgedParts, judgeFindings, questionsFor, scorePart, type JudgeOutput } from "./judge.ts";
import type { PackageIssue } from "../marinara/validate.ts";
import type { Clues, Facts, Plan } from "../pipeline/schemas.ts";
import { findDuplicates, findSpoilers, findUnreachableClues, structureFindings } from "./code-checks.ts";
import { qualityReviewPrompt, qualityReviewSchema, spoilerReviewPrompt, spoilerReviewSchema, toFindings } from "./review.ts";
import { textUnits, type AuditFinding, type AuditOutput, type TextUnit } from "./units.ts";

export interface AuditInput {
  projectId: string;
  requirements: Requirements;
  pkg: AdventurePackage;
  issues: PackageIssue[];
  plan: Plan;
  facts: Facts;
  clues: Clues | null;
  /** Stage id → spoiler-free label, for stages that can be regenerated with a fix note. */
  targets: Map<string, string>;
  text: TextGenerator;
  embedder: Embedder | null;
  decider: Decider | null;
  /** A judged part passes above this. */
  judgeThreshold: number;
  repairAttempts: number;
  /** The last audit of this adventure: parts it read that have not changed keep their results. */
  previous?: AuditOutput | null;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One hash per fix target, over exactly the text the reviews and the judge read for it. */
export function partHashes(pkg: AdventurePackage): Record<string, string> {
  const out: Record<string, string> = {};
  const opening = pkg.characters.find((c) => c.key === pkg.openingCardKey);
  for (const card of pkg.characters) {
    const { avatar: _avatar, ...rest } = card as typeof card & { avatar?: string };
    out[`card:${card.key}`] = hash(card.key === pkg.openingCardKey ? { ...rest, firstMessage: null } : rest);
  }
  if (pkg.persona) {
    const { avatar: _avatar, ...persona } = pkg.persona;
    out.persona = hash(persona);
  }
  for (const lb of pkg.lorebooks) out[`lorebook:${lb.key}`] = hash(lb);
  out.opening = hash([pkg.teaser, opening?.firstMessage ?? null]);
  return out;
}

const KICKOFF = [{ role: "user" as const, content: "Produce the JSON now." }];

/** Pairs of units that mean nearly the same thing, by embeddings; the quality review judges them. */
async function semanticCandidates(input: AuditInput, units: TextUnit[], already: AuditFinding[]) {
  const pool = units.filter((u) => u.kind === "card-field" || u.kind === "entry" || u.kind === "persona-field");
  const vectors = await input.embedder!.embed(
    pool.map((u) => u.text.slice(0, 2000)),
    input.projectId,
    "audit-embeddings",
  );
  const pairs: Array<{ a: TextUnit; b: TextUnit; similarity: number }> = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) pairs.push({ a: pool[i]!, b: pool[j]!, similarity: cosine(vectors[i]!, vectors[j]!) });
  }
  if (pairs.length === 0) return [];
  // Embedding models differ in their baseline similarity, so flag outliers relative to this package.
  const mean = pairs.reduce((n, p) => n + p.similarity, 0) / pairs.length;
  const sd = Math.sqrt(pairs.reduce((n, p) => n + (p.similarity - mean) ** 2, 0) / pairs.length);
  const flagged = new Set(already.map((f) => f.where));
  return pairs
    .filter((p) => p.similarity >= Math.max(0.85, mean + 3 * sd) && !flagged.has(`${p.a.where} and ${p.b.where}`))
    .sort((x, y) => y.similarity - x.similarity)
    .slice(0, 15);
}

/** Runs every check of spec §12 that this version can run, and says which it could not. */
export async function runAudit(input: AuditInput): Promise<AuditOutput> {
  const units = textUnits(input.pkg);
  const memo = { basis: hash([input.requirements, input.plan, input.facts, input.clues]), parts: partHashes(input.pkg) };
  // After a fix round only some parts changed. With the same plan, facts and requirements, the
  // model reviews re-read just those parts and earlier findings on the rest stay (spec §15 rounds).
  const previous = input.previous?.memo?.basis === memo.basis ? input.previous : null;
  const changed = previous
    ? new Set(Object.keys({ ...memo.parts, ...previous.memo!.parts }).filter((id) => memo.parts[id] !== previous.memo!.parts[id]))
    : null;
  const isChanged = (target: string | null) => !changed || (target !== null && changed.has(target));
  const checked: string[] = [
    "Structure, limits and references (code)",
    "Near-verbatim repetition across cards, persona, lorebooks and opening (code)",
    "Secret facts echoed in names, tags, teaser, persona and greetings (code heuristic)",
  ];
  const notChecked: string[] = [
    "Portraits against Appearance (no avatars yet)",
    "Behaviour inside Marinara after import (use Push to Marinara or import manually)",
  ];

  const findings: AuditFinding[] = [
    ...structureFindings(input.issues),
    ...findDuplicates(units),
    ...findSpoilers(units, input.facts.facts),
    ...findUnreachableClues(input.pkg, input.plan, input.clues),
  ];
  if (input.clues) checked.push("Every clue surfaces when its place or person comes up (activation simulator)");

  let candidates: Array<{ a: TextUnit; b: TextUnit; similarity: number }> = [];
  const embedding = input.embedder?.describe() ?? null;
  if (changed?.size === 0) {
    // Nothing the reviews read has changed; keep their results below.
  } else if (embedding) {
    try {
      candidates = (await semanticCandidates(input, units, findings)).filter((c) => isChanged(c.a.stage) || isChanged(c.b.stage));
      checked.push(`Paraphrased duplicates by embeddings (${embedding}), judged by the quality review`);
    } catch (error) {
      notChecked.push(`Paraphrased duplicates by embeddings: ${error instanceof GenerationError ? error.message : "embedding request failed"}`);
    }
  } else {
    notChecked.push("Paraphrased duplicates by embeddings (no embedding model assigned; the quality review still looks for them)");
  }

  // Model findings on parts that did not change carry over; plan-level ones too, since the plan did not change.
  if (previous) {
    const kept = previous.findings.filter((f) => f.source === "model" && !f.id.startsWith("judge:") && (f.target === null || !changed!.has(f.target)));
    findings.push(...kept.map((f, i) => ({ ...f, id: `kept-${i + 1}` })));
  }
  const recheck = changed ? [...changed].filter((id) => input.targets.has(id)) : null;

  if (!recheck || recheck.length > 0) {
    const only = recheck ? new Set(recheck) : undefined;
    const quality = await input.text.generateJson(
      qualityReviewSchema,
      {
        projectId: input.projectId,
        purpose: "audit-review",
        system: qualityReviewPrompt(input.requirements, input.plan, input.facts, input.clues, input.pkg, input.targets, candidates, only),
        messages: KICKOFF,
      },
      input.repairAttempts,
    );
    // A re-check may only report on what it read.
    findings.push(...toFindings(null, quality.findings, input.targets).filter((f) => !only || f.target === null || only.has(f.target)));

    const visible = units.filter((u) => u.visible && (!only || only.has(u.stage)));
    if (visible.length > 0) {
      const spoilers = await input.text.generateJson(
        spoilerReviewSchema,
        {
          projectId: input.projectId,
          purpose: "audit-spoilers",
          system: spoilerReviewPrompt(input.plan, input.facts, visible, input.targets),
          messages: KICKOFF,
        },
        input.repairAttempts,
      );
      findings.push(...toFindings("spoilers", spoilers.findings, input.targets).filter((f) => !only || f.target === null || only.has(f.target)));
    }
  }
  checked.push("Consistency, distinct voices, paraphrased duplicates, mystery logic and prose voice (model review, heuristic)");
  checked.push("Spoilers in everything the player sees (model review, heuristic)");
  if (recheck) {
    const total = Object.keys(memo.parts).length;
    checked.push(`Re-check after revisions: the model reviews read ${recheck.length} changed of ${total} parts; earlier results kept for the rest`);
  }

  let judge: JudgeOutput | null = null;
  const decision = input.decider?.describe() ?? null;
  if (decision) {
    try {
      const parts = judgedParts(input.pkg, input.requirements);
      const earlier = input.previous?.judge?.parts ?? [];
      let rescored = 0;
      const scored = await Promise.all(
        parts.map(async (part) => {
          const questions = questionsFor(part);
          // Same judge, same questions, same text: the earlier score stands.
          const key = hash([decision, part.state, questions]);
          const same = earlier.find((p) => p.stage === part.stage && p.key === key);
          if (same) return same;
          rescored++;
          return { ...scorePart(part, await input.decider!.decide(input.projectId, "audit-judge", part.state, questions)), key };
        }),
      );
      judge = { model: decision, threshold: input.judgeThreshold, parts: scored };
      findings.push(...judgeFindings(judge));
      checked.push(
        `Fit to the approved requirements and overall quality, part by part (decision model: ${decision}${rescored < parts.length ? `; ${rescored} of ${parts.length} parts re-scored, the rest unchanged` : ""})`,
      );
    } catch (error) {
      notChecked.push(`Fit and quality by a decision model: ${error instanceof GenerationError ? error.message : "decision request failed"}`);
    }
  } else {
    notChecked.push("Fit and quality by a decision model (no decision model assigned)");
  }

  return { findings, checked, notChecked, judge, memo };
}
