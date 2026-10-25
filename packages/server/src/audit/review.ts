import { z } from "zod";
import type { AdventurePackage, AuditArea, Requirements } from "@adv/shared";
import { brief } from "../pipeline/prompts.ts";
import type { Clues, Facts, Plan } from "../pipeline/schemas.ts";
import type { AuditFinding, TextUnit } from "./units.ts";

const severity = z.enum(["major", "minor"]);

export const qualityReviewSchema = z.object({
  findings: z
    .array(
      z.object({
        area: z.enum(["consistency", "voices", "duplicates", "mystery", "style"]),
        severity,
        target: z.string().min(1).max(60),
        detail: z.string().trim().min(1).max(1500),
        fix: z.string().trim().min(1).max(1500),
      }),
    )
    .max(30),
});

export const spoilerReviewSchema = z.object({
  findings: z
    .array(
      z.object({
        target: z.string().min(1).max(60),
        severity,
        detail: z.string().trim().min(1).max(1500),
        fix: z.string().trim().min(1).max(1500),
      }),
    )
    .max(20),
});

const JSON_ONLY = "Reply with ONLY one JSON object matching the shape below. No prose, no code fences.";

function targetList(targets: Map<string, string>): string {
  return [...targets].map(([id, label]) => `- ${id}: ${label}`).join("\n");
}

function packageText(pkg: AdventurePackage): string {
  const cards = pkg.characters.map(
    (c) =>
      `### card:${c.key} — ${c.name}\nDescription: ${c.description}\nPersonality: ${c.personality}\nBackstory: ${c.backstory}\nAppearance: ${c.appearance}\nScenario: ${c.scenario}\nFirst message: ${c.firstMessage}\nExample dialogue: ${c.exampleDialogue}`,
  );
  const persona = pkg.persona
    ? [`### persona — ${pkg.persona.name}\n${pkg.persona.description}\n${pkg.persona.personality}\n${pkg.persona.backstory}\n${pkg.persona.scenario}`]
    : [];
  const lore = pkg.lorebooks.map(
    (lb) =>
      `### lorebook:${lb.key} — ${lb.name}\n${lb.entries
        .map((e, i) => `#${i + 1} ${e.name} [keys: ${e.keys.join(", ")}${e.privateTo.length ? `; private to ${e.privateTo.join(", ")}` : ""}]\n${e.content}`)
        .join("\n")}`,
  );
  return [...cards, ...persona, ...lore, `### Teaser\n${pkg.teaser}`].join("\n\n");
}

export function qualityReviewPrompt(
  r: Requirements,
  plan: Plan,
  facts: Facts,
  clues: Clues | null,
  pkg: AdventurePackage,
  targets: Map<string, string>,
  candidates: Array<{ a: TextUnit; b: TextUnit; similarity: number }>,
): string {
  return `Stage: audit-review
You audit a generated adventure for the Marinara Engine roleplay app before the player receives it. The player must discover the story in play, so this material is hidden from them. Report real problems only; an empty list is a fine answer.

Check:
- consistency: contradictions between cards, lorebooks and the truth (names, relations, timeline, places, rules of magic); a character stating as fact something their knowledge layer says they cannot know. Lies and wrong beliefs that are marked as such are intended, not errors.
- voices: card characters whose voice, goals or reactions are too similar to tell apart.
- duplicates: the same fact told in several places in other words, or two versions of the same information that disagree. Short deliberate echoes (dialogue illustrating personality) are fine.
- mystery: ${clues ? "can a careful player reach every conclusion from clues that exist in the material? Are red herrings explainable? Does the solution rely on a rule never established?" : "skip unless the material contains a mystery."}
- style: play text (first messages, example dialogue) and, more lightly, descriptive text should follow the requested prose voice.
For each finding pick the ONE target that should be rewritten to fix it, from this list (use "package" when no single part can fix it, e.g. a logic hole in the truth itself):
${targetList(targets)}
- package: the plan or truth itself
"detail" explains the problem for the developer; "fix" is an instruction to the writer of the target part, specific enough to act on.
${candidates.length ? `\nPossible paraphrased duplicates found by embeddings (judge them; report only real ones):\n${candidates.map((c) => `- ${c.a.where} ~ ${c.b.where} (similarity ${c.similarity.toFixed(2)})`).join("\n")}\n` : ""}
${brief(r)}

TRUTH
${plan.truth.summary}
Timeline: ${plan.truth.timeline.map((t) => `${t.when}: ${t.what}`).join("; ")}
${plan.isMystery ? `Culprit: ${plan.truth.culprit ?? "none"}; motive: ${plan.truth.motive}; method: ${plan.truth.method}` : ""}

FACT REGISTRY
${facts.facts.map((f) => `${f.id} [${f.layer}${f.holder ? ` of ${f.holder}` : ""}, ${f.secrecy}] ${f.subject}: ${f.statement}`).join("\n")}
${clues ? `\nCLUES\n${JSON.stringify(clues)}` : ""}

MATERIAL
${packageText(pkg)}

${JSON_ONLY}
{"findings": [{"area": "consistency|voices|duplicates|mystery|style", "severity": "major|minor", "target": "card:...|persona|lorebook:...|opening|package", "detail": "...", "fix": "..."}]}`;
}

export function spoilerReviewPrompt(plan: Plan, facts: Facts, visible: TextUnit[], targets: Map<string, string>): string {
  return `Stage: audit-spoilers
You check what the PLAYER sees of an adventure before and during play for spoilers. The player wants to discover the story; seeing a secret, the culprit, a hidden motive, a twist or a strong hint at one ruins it.
Visible material: character names and library tags, the persona card, the teaser, greetings and the opening scene, lorebook entry names and keys. Introducing characters, places and the starting situation is fine; giving away or loudly hinting at what is hidden is not. A greeting may show a character's evasiveness or mood without stating the secret behind it.
Report only real spoilers or strong hints; an empty list is a fine answer. For each, pick the target that should be rewritten:
${targetList(targets)}

SECRETS (never visible to the player)
${plan.truth.summary}
${plan.isMystery ? `Culprit: ${plan.truth.culprit ?? "none"}; motive: ${plan.truth.motive}; method: ${plan.truth.method}` : ""}
${facts.facts
  .filter((f) => f.secrecy !== "public")
  .map((f) => `- ${f.statement}`)
  .join("\n")}

VISIBLE MATERIAL
${visible.map((u) => `[${u.stage}] ${u.where}: ${u.text}`).join("\n")}

${JSON_ONLY}
{"findings": [{"target": "card:...|persona|lorebook:...|opening", "severity": "major|minor", "detail": "...", "fix": "..."}]}`;
}

const SUMMARY: Record<Exclude<AuditArea, "structure" | "activation">, (where: string) => string> = {
  consistency: (w) => `${w}: possible contradiction with established facts.`,
  voices: (w) => `${w}: voice or goals too close to another character.`,
  duplicates: (w) => `${w}: repeats information found elsewhere, in other words.`,
  mystery: (w) => `${w}: the mystery may not be fairly solvable as written.`,
  style: (w) => `${w}: prose voice drifts from the requested style.`,
  spoilers: (w) => `${w} may reveal hidden information.`,
};

let counter = 0;

/** Model findings get a code-written summary; the model's own words go only into detail and fix. */
export function toFindings(
  area: Exclude<AuditArea, "structure" | "activation"> | null,
  items: Array<{ area?: string; severity: "major" | "minor"; target: string; detail: string; fix: string }>,
  targets: Map<string, string>,
): AuditFinding[] {
  return items.map((item) => {
    const a = (area ?? item.area) as Exclude<AuditArea, "structure" | "activation">;
    const known = targets.has(item.target);
    const where = known ? targets.get(item.target)! : "Package";
    return {
      id: `model-${++counter}`,
      area: a,
      severity: item.severity,
      source: "model" as const,
      target: known ? item.target : null,
      where,
      summary: SUMMARY[a](where),
      detail: item.detail,
      fix: known ? item.fix : null,
    };
  });
}
