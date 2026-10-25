import type { AdventurePackage } from "@adv/shared";
import type { Clues, Fact, Plan } from "../pipeline/schemas.ts";
import { simulateActivation } from "../marinara/simulate.ts";
import type { PackageIssue } from "../marinara/validate.ts";
import type { AuditFinding, TextUnit } from "./units.ts";

const STOP = new Set(
  "the a an and or but of to in on at by for with from as is was were be been are it its this that these those he she they his her their them him you your we our i me my not no so if then than there here who whom what which when where why how all any some into over under about after before".split(
    " ",
  ),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\{\{(user|char)\}\}/g, " ")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);

function shingles(text: string, n = 6): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

/**
 * Near-verbatim repetition across the package (spec §11). Six-word runs shared between two units
 * mean a copied passage. Example dialogue may echo personality on purpose, so it is skipped.
 */
export function findDuplicates(units: TextUnit[]): AuditFinding[] {
  const pool = units.filter((u) => u.kind === "card-field" || u.kind === "entry" || u.kind === "persona-field" || u.kind === "opening");
  const sets = pool.map((u) => ({ u, s: shingles(u.text) }));
  const findings: AuditFinding[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      let shared = 0;
      const sample: string[] = [];
      for (const s of a.s) {
        if (b.s.has(s)) {
          shared++;
          if (sample.length < 2) sample.push(s);
        }
      }
      if (shared < 4) continue;
      // Keep card text, trim the lorebook copy; between two cards or entries, fix the later one.
      const fixIn = b.u.kind === "entry" || a.u.kind !== "entry" ? b.u : a.u;
      const keep = fixIn === b.u ? a.u : b.u;
      findings.push({
        id: nextId("dup"),
        area: "duplicates",
        severity: shared >= 10 ? "major" : "minor",
        source: "code",
        target: fixIn.stage === "assemble" ? null : fixIn.stage,
        where: `${a.u.where} and ${b.u.where}`,
        summary: `${a.u.where} and ${b.u.where} repeat the same passage (${shared} shared six-word runs).`,
        detail: `Shared text, e.g.: "${sample.join('" / "')}"`,
        fix: `${fixIn.where} repeats a passage that also appears in ${keep.where} (e.g. "${sample[0]}"). Keep the information in one place: remove or condense the repeated passage here and refer to the subject briefly instead.`,
      });
    }
  }
  return findings;
}

/** Words that, in a name, tag or teaser, tend to give the hidden story away. */
const SPOILER_WORDS =
  /\b(killer|murderer|culprit|guilty|secretly|true identity|traitor|betray\w*|blackmail\w*|framed|frame-up|cover-?up|accomplice|double life|impostor|poisoner|real (killer|culprit|father|mother|name))\b/i;

const contentWords = (text: string) => new Set(words(text).filter((w) => w.length >= 5 && !STOP.has(w)));

/**
 * Hidden information in what the player sees (spec §4, §12.9): secret facts whose distinctive
 * words reappear in visible text, and give-away words in names, tags and the teaser.
 * Heuristic: it flags candidates; the spoiler review judges them.
 */
export function findSpoilers(units: TextUnit[], facts: Fact[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const secrets = facts.filter((f) => f.secrecy === "secret").map((f) => ({ f, w: contentWords(f.statement) }));
  for (const u of units.filter((x) => x.visible)) {
    const strong = u.kind === "teaser" || u.kind === "name" || u.kind === "tag" || u.kind === "persona-field" || u.kind === "opening";
    if (u.kind !== "first-message" && u.kind !== "opening" && SPOILER_WORDS.test(u.text)) {
      findings.push({
        id: nextId("spoiler"),
        area: "spoilers",
        severity: strong ? "major" : "minor",
        source: "code",
        target: u.stage === "assemble" ? null : u.stage,
        where: u.where,
        summary: `${u.where} uses a word that may give the hidden story away.`,
        detail: `Visible text: "${u.text.slice(0, 200)}"`,
        fix: `In ${u.where}, the visible text "${u.text.slice(0, 120)}" contains a give-away word (${u.text.match(SPOILER_WORDS)?.[0]}). Rephrase it neutrally so it hints at nothing hidden.`,
      });
    }
    const visibleWords = contentWords(u.text);
    for (const { f, w } of secrets) {
      if (w.size < 4) continue;
      const overlap = [...w].filter((x) => visibleWords.has(x));
      if (overlap.length / w.size >= 0.6) {
        findings.push({
          id: nextId("spoiler"),
          area: "spoilers",
          severity: strong ? "major" : "minor",
          source: "code",
          target: u.stage === "assemble" ? null : u.stage,
          where: u.where,
          summary: `${u.where} may reveal a secret of the adventure.`,
          detail: `Secret fact ${f.id} ("${f.statement}") shares ${overlap.length} of ${w.size} distinctive words with this visible text.`,
          fix: `${u.where} is visible to the player but echoes a secret ("${f.statement}"). Remove anything that reveals or strongly hints at it.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Every clue must be able to surface when its place or person comes up in play (spec §9: missing
 * one clue must not block progress). Checked with the activation simulator, all cards present.
 */
export function findUnreachableClues(pkg: AdventurePackage, plan: Plan, clues: Clues | null): AuditFinding[] {
  if (!clues) return [];
  const findings: AuditFinding[] = [];
  const cards = pkg.characters.map((c) => c.key);
  const entryOfFact = new Map<string, { lb: string; key: string; name: string }>();
  for (const lb of pkg.lorebooks) {
    lb.entries.forEach((e, i) => {
      for (const id of e.factIds) entryOfFact.set(id, { lb: lb.key, key: e.key, name: `Lorebook: ${lb.name}, entry #${i + 1}` });
    });
  }
  for (const clue of clues.clues) {
    if (!clue.factId) continue;
    const home = entryOfFact.get(clue.factId);
    if (!home) continue; // Homed in a card: always present when that character is.
    const place = plan.entities.find((e) => e.key === clue.where);
    if (!place) continue;
    const mention = [place.name, ...place.aliases].join(", ");
    const result = simulateActivation(pkg, [{ role: "user", content: `We look around ${mention}.` }], { activeCardKeys: cards });
    const hit = result.entries.find((x) => x.lorebookKey === home.lb && x.entryKey === home.key);
    if (hit?.status !== "activated") {
      findings.push({
        id: nextId("clue"),
        area: "activation",
        severity: "major",
        source: "code",
        target: `lorebook:${home.lb}`,
        where: home.name,
        summary: `${home.name} holds a clue that does not surface when the place or person it belongs to comes up.`,
        detail: `Clue ${clue.id} (${clue.how}) is in fact ${clue.factId}; mentioning "${mention}" does not activate the entry.`,
        fix: `The entry holding clue ${clue.id} (fact ${clue.factId}, found at ${place.name}) must activate when ${place.name} comes up: add "${place.name}" and its aliases (${place.aliases.join(", ") || "none"}) to its keys.`,
      });
    }
  }
  return findings;
}

/** Structural validation warnings become audit findings; entry-level ones can be fixed in their lorebook stage. */
export function structureFindings(issues: PackageIssue[]): AuditFinding[] {
  return issues
    .filter((i) => i.severity === "warning")
    .map((i) => ({
      id: nextId("struct"),
      area: "structure" as const,
      severity: "minor" as const,
      source: "code" as const,
      target: i.target ?? null,
      where: i.where ?? "Package",
      summary: i.summary,
      detail: i.detail ?? "",
      fix: i.target ? `Fix this in your output: ${i.summary}${i.detail ? ` (${i.detail})` : ""}` : null,
    }));
}
