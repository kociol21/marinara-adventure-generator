import type { Requirements } from "@adv/shared";

/**
 * How much material an adventure of a given length needs. The first real run (2026-10-25,
 * medium noir) came back thin: 11 entities, 60 facts, 20 lorebook entries of ~60 tokens and
 * only 5 beliefs/claims. These floors are fed into the prompts and enforced by the stage checks,
 * which send a too-thin result back to the model within the auto-fix limit.
 */
export interface ScaleTargets {
  entities: number;
  locations: number;
  minorCharacters: number;
  facts: [min: number, max: number];
  /** Beliefs and claims per card character (lies, alibis, wrong guesses). */
  perspectivesPerCard: number;
  /** Minimum words per non-constant lorebook entry. */
  entryWords: number;
}

const TARGETS: Record<Requirements["scale"]["length"], ScaleTargets> = {
  "one-shot": { entities: 7, locations: 2, minorCharacters: 1, facts: [35, 70], perspectivesPerCard: 1, entryWords: 30 },
  short: { entities: 10, locations: 3, minorCharacters: 2, facts: [55, 100], perspectivesPerCard: 2, entryWords: 40 },
  medium: { entities: 14, locations: 4, minorCharacters: 3, facts: [80, 150], perspectivesPerCard: 3, entryWords: 50 },
  long: { entities: 20, locations: 6, minorCharacters: 5, facts: [120, 220], perspectivesPerCard: 4, entryWords: 60 },
};

export function scaleTargets(r: Requirements): ScaleTargets {
  return TARGETS[r.scale.length];
}

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
