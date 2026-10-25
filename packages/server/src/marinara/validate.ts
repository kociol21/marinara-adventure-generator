import type { AdventurePackage, LorebookDraft, LorebookEntryDraft } from "@adv/shared";
import { DEFAULT_CHAT_LOREBOOK_BUDGET, estimateTokens } from "./tokens.ts";

export type IssueSeverity = "error" | "warning" | "info";

export interface PackageIssue {
  severity: IssueSeverity;
  code: string;
  /** Spoiler-free: names only what the player may see (card names, lorebook names, entry numbers). */
  summary: string;
  /** May quote hidden content; shown only behind "Show spoilers". */
  detail?: string;
  /** Lorebook stage that can fix an entry-level issue (pipeline stage id). */
  target?: string;
  /** Spoiler-free place, e.g. `"Plot" entry #3`. */
  where?: string;
}

/** Words so common in prose that, as primary keys, they fire in almost every scene. */
const BROAD_KEYS = new Set(
  [
    "a", "an", "the", "he", "she", "it", "they", "him", "her", "his", "you", "i", "we", "me", "man", "woman", "men",
    "people", "person", "day", "night", "time", "home", "house", "room", "door", "city", "town", "street", "place",
    "thing", "way", "hand", "eyes", "face", "voice", "king", "queen", "friend", "work", "money", "case", "office",
    "bar", "car", "gun", "light", "dark", "water", "food", "drink", "old", "new", "good", "bad",
  ].map((w) => w.toLowerCase()),
);

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

const entryRef = (lb: LorebookDraft, index: number) => `"${lb.name}" entry #${index + 1}`;

function hasActivationPath(entry: LorebookEntryDraft, lb: LorebookDraft): boolean {
  if (entry.type === "constant") return true;
  if (entry.keys.length > 0) return true;
  if (lb.vectors.enabled && !entry.noVector) return true;
  return entry.decision?.mode === "trigger";
}

/** Structural checks done by code (spec §12): formats, references, limits, activation and budgets. */
export function validatePackage(pkg: AdventurePackage): PackageIssue[] {
  const issues: PackageIssue[] = [];
  let place: { target: string; where: string } | null = null;
  const add = (severity: IssueSeverity, code: string, summary: string, detail?: string) =>
    issues.push({ severity, code, summary, ...(detail ? { detail } : {}), ...(place ?? {}) });

  // ── Cast ──
  if (pkg.characters.length > pkg.maxNpcCards) {
    add("error", "card-limit", `${pkg.characters.length} character cards exceed the approved limit of ${pkg.maxNpcCards}.`);
  }
  const cardKeys = new Set<string>();
  const cardNames = new Set<string>();
  for (const card of pkg.characters) {
    if (cardKeys.has(card.key)) add("error", "duplicate-card-key", `Two cards share the internal key "${card.key}".`);
    cardKeys.add(card.key);
    const lower = card.name.toLowerCase();
    if (cardNames.has(lower)) add("error", "duplicate-card-name", `Two cards are named "${card.name}".`);
    cardNames.add(lower);

    for (const field of ["description", "personality", "scenario", "appearance"] as const) {
      if (!card[field].trim()) add("error", "empty-card-field", `"${card.name}" has an empty ${field} field.`);
    }
    for (const field of ["backstory", "exampleDialogue"] as const) {
      if (!card[field].trim()) add("warning", "empty-card-field", `"${card.name}" has an empty ${field} field.`);
    }
    if (card.exampleDialogue.trim() && !card.exampleDialogue.includes("<START>")) {
      add("warning", "example-format", `"${card.name}" example dialogue has no <START> separators.`);
    }
    if (card.avatar && card.avatar.length * 0.75 > MAX_AVATAR_BYTES) {
      add("warning", "avatar-size", `"${card.name}" avatar is larger than 8 MB.`);
    }
  }

  const opening = pkg.characters.find((c) => c.key === pkg.openingCardKey);
  if (!opening) add("error", "opening-card", "The opening card is not one of the adventure's cards.");
  else if (!opening.firstMessage.trim()) add("error", "opening-empty", `"${opening.name}" opens the adventure but has no first message.`);
  const otherGreetings = pkg.characters.filter((c) => c.key !== pkg.openingCardKey && c.firstMessage.trim());
  if (otherGreetings.length > 0) {
    add(
      "info",
      "extra-greetings",
      `${otherGreetings.map((c) => `"${c.name}"`).join(", ")} also ${otherGreetings.length === 1 ? "has a first message" : "have first messages"}; only the opening card's greeting starts the shared scene.`,
    );
  }

  // ── Lorebooks ──
  const lorebookKeys = new Set<string>();
  let constantTokensTotal = 0;
  for (const lb of pkg.lorebooks) {
    if (lorebookKeys.has(lb.key)) add("error", "duplicate-lorebook-key", `Two lorebooks share the internal key "${lb.key}".`);
    lorebookKeys.add(lb.key);
    if (lb.entries.length === 0) add("warning", "empty-lorebook", `Lorebook "${lb.name}" has no entries.`);

    const entryKeys = new Set<string>();
    let constantTokens = 0;
    let constantCount = 0;
    lb.entries.forEach((entry, i) => {
      const ref = entryRef(lb, i);
      place = { target: `lorebook:${lb.key}`, where: ref };
      if (entryKeys.has(entry.key)) add("error", "duplicate-entry-key", `${ref} reuses an internal key.`);
      entryKeys.add(entry.key);

      const tokens = estimateTokens(entry.content);
      if (!entry.content.trim()) add("error", "empty-entry", `${ref} has no content.`);
      if (lb.tokenBudget > 0 && tokens > lb.tokenBudget) {
        add("error", "entry-over-budget", `${ref} (~${tokens} tokens) can never fit the lorebook budget of ${lb.tokenBudget}.`);
      }
      if (entry.type === "constant") {
        constantTokens += tokens;
        constantCount += 1;
      }

      if (!hasActivationPath(entry, lb)) {
        add("error", "no-activation", `${ref} has no way to activate (no keys, not constant, no vectors, no trigger statement).`, entry.name);
      }
      if (entry.type === "selective" && entry.secondaryKeys.length === 0) {
        add("warning", "selective-without-secondary", `${ref} is selective but has no secondary keys, so it behaves like a normal entry.`);
      }
      if (entry.decision?.mode === "trigger" && entry.keys.length === 0 && entry.type !== "constant") {
        add("warning", "decision-only", `${ref} activates only through a decision statement, which needs a Decision model in Marinara.`);
      }

      for (const k of entry.keys) {
        const lower = k.trim().toLowerCase();
        if (entry.useRegex) {
          try {
            new RegExp(k);
          } catch {
            add("error", "invalid-regex", `${ref} has a key that is not a valid regular expression.`, k);
          }
          continue;
        }
        if (lower.length <= 2) add("error", "key-too-short", `${ref} has a key of ${lower.length} characters, which matches almost anything.`, k);
        else if (BROAD_KEYS.has(lower) && entry.type !== "selective") {
          add("warning", "broad-key", `${ref} uses a very common word as a key without secondary keys.`, k);
        } else if (lower.length <= 4 && !entry.matchWholeWords) {
          add("warning", "short-key-substring", `${ref} has a short key without whole-word matching, so it can match inside other words.`, k);
        }
      }

      for (const cardKey of entry.privateTo) {
        if (!cardKeys.has(cardKey)) add("error", "unknown-private-card", `${ref} is private to a card that does not exist.`, cardKey);
      }
      if (entry.position === "outlet" && !entry.outletName.trim()) add("error", "outlet-name", `${ref} uses Outlet position without an outlet name.`);
      place = null;
    });

    if (lb.tokenBudget > 0 && constantTokens > lb.tokenBudget) {
      add("error", "constant-over-budget", `Constant entries in "${lb.name}" need ~${constantTokens} tokens, more than its budget of ${lb.tokenBudget}.`);
    }
    if (constantCount > 8) add("warning", "many-constants", `"${lb.name}" has ${constantCount} constant entries; keep always-on facts few.`);
    if (lb.vectors.enabled && lb.entries.every((e) => e.noVector || e.type === "constant")) {
      add("warning", "vectors-unused", `"${lb.name}" has vectors on, but no entry can match by meaning.`);
    }
    constantTokensTotal += constantTokens;
  }
  if (constantTokensTotal > DEFAULT_CHAT_LOREBOOK_BUDGET / 2) {
    add(
      "warning",
      "constants-crowd-budget",
      `Constant entries need ~${constantTokensTotal} tokens in every reply, over half of Marinara's default chat lorebook budget (${DEFAULT_CHAT_LOREBOOK_BUDGET}).`,
    );
  }

  return issues;
}
