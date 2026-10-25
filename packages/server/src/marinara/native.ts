import type { AdventurePackage, CardDraft, LorebookDraft, LorebookEntryDraft, PersonaDraft } from "@adv/shared";

/**
 * Mapping to Marinara Engine's native export format (`.marinara.json` envelopes, version 1),
 * as read by its importer (verified against Marinara 2.5.1, see docs/01-weryfikacja-techniczna.md).
 */

export type NativeType = "marinara_character" | "marinara_persona" | "marinara_lorebook";

export interface NativeEnvelope<T = Record<string, unknown>> {
  type: NativeType;
  version: 1;
  exportedAt: string;
  data: T;
}

export const GENERATOR_NAME = "Marinara Adventure Generator";

export function slugify(value: string, max = 24): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "adventure";
}

/**
 * Tag that marks a card for private lorebook entries. Character-id filters do not survive
 * file import (the ids belong to the source install), but card tags do, so private entries
 * filter on this tag. It is visible in Marinara's library, so it carries only names.
 */
export function privateTag(adventureTitle: string, cardKey: string): string {
  return `adv-${slugify(adventureTitle)}-${cardKey}`.slice(0, 50);
}

const SELECTIVE_LOGIC: Record<LorebookEntryDraft["selectiveLogic"], string> = {
  and_any: "and",
  and_all: "and_all",
  not_any: "not",
  not_all: "not_all",
};

const POSITION: Record<LorebookEntryDraft["position"], number> = {
  before_chat: 0,
  after_chat: 1,
  at_depth: 2,
  outlet: 7,
};

function envelope<T extends Record<string, unknown>>(type: NativeType, data: T, exportedAt: string): NativeEnvelope<T> {
  return { type, version: 1, exportedAt, data };
}

export function nativeCharacter(card: CardDraft, adventureTitle: string, exportedAt: string): NativeEnvelope {
  return envelope(
    "marinara_character",
    {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: card.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        first_mes: card.firstMessage,
        mes_example: card.exampleDialogue,
        alternate_greetings: card.alternateGreetings,
        tags: [...new Set([...card.tags, privateTag(adventureTitle, card.key)])],
        creator: GENERATOR_NAME,
        creator_notes: "",
        character_version: "1.0",
        extensions: {
          backstory: card.backstory,
          appearance: card.appearance,
          ...(card.imageAppearance ? { imageAppearanceEnabled: true, imageAppearance: card.imageAppearance } : {}),
        },
      },
      ...(card.avatar ? { avatar: card.avatar } : {}),
      metadata: { comment: adventureTitle },
    },
    exportedAt,
  );
}

export function nativePersona(persona: PersonaDraft, exportedAt: string): NativeEnvelope {
  return envelope(
    "marinara_persona",
    {
      name: persona.name,
      description: persona.description,
      personality: persona.personality,
      backstory: persona.backstory,
      appearance: persona.appearance,
      scenario: persona.scenario,
      mes_example: persona.exampleDialogue,
      tags: persona.tags,
      creator: GENERATOR_NAME,
      ...(persona.avatar ? { avatar: persona.avatar } : {}),
    },
    exportedAt,
  );
}

export function nativeEntry(entry: LorebookEntryDraft, adventureTitle: string) {
  const privateTags = entry.privateTo.map((cardKey) => privateTag(adventureTitle, cardKey));
  return {
    name: entry.name,
    content: entry.content,
    description: entry.description,
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    enabled: true,
    constant: entry.type === "constant",
    selective: entry.type === "selective",
    selectiveLogic: SELECTIVE_LOGIC[entry.selectiveLogic],
    probability: entry.probability,
    scanDepth: entry.scanDepth,
    matchWholeWords: entry.matchWholeWords,
    caseSensitive: entry.caseSensitive,
    useRegex: entry.useRegex,
    characterFilterMode: "any",
    characterFilterIds: [],
    characterTagFilterMode: privateTags.length ? "include" : "any",
    characterTagFilters: privateTags,
    generationTriggerFilterMode: "any",
    generationTriggerFilters: [],
    position: POSITION[entry.position],
    outletName: entry.outletName,
    depth: entry.depth,
    order: entry.order,
    role: entry.role,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
    delay: entry.delay,
    ephemeral: entry.ephemeral,
    group: entry.group,
    groupWeight: entry.groupWeight,
    locked: false,
    preventRecursion: !entry.recursion,
    excludeRecursion: false,
    delayUntilRecursion: false,
    excludeFromVectorization: entry.noVector,
    tag: entry.tag,
    decisionMode: entry.decision?.mode ?? "off",
    decisionStatement: entry.decision?.statement ?? "",
  };
}

export function nativeLorebook(lorebook: LorebookDraft, adventureTitle: string, exportedAt: string): NativeEnvelope {
  return envelope(
    "marinara_lorebook",
    {
      lorebook: {
        name: lorebook.name,
        description: lorebook.description,
        category: lorebook.category,
        scanDepth: lorebook.scanDepth,
        tokenBudget: lorebook.tokenBudget,
        entryLimit: lorebook.entryLimit,
        recursiveScanning: lorebook.recursiveScanning,
        maxRecursionDepth: lorebook.maxRecursionDepth,
        // Marinara's lorebook "Vectors" switch is stored inverted.
        excludeFromVectorization: !lorebook.vectors.enabled,
        vectorQueryDepth: lorebook.vectors.queryMessages,
        vectorScoreThreshold: lorebook.vectors.scoreThreshold,
        vectorMaxResults: lorebook.vectors.maxResults,
        // Never global, never linked by id: ids from this generator mean nothing to the target install.
        isGlobal: false,
        characterIds: [],
        personaIds: [],
        chatId: null,
        enabled: true,
        tags: lorebook.tags,
      },
      entries: lorebook.entries.map((entry) => nativeEntry(entry, adventureTitle)),
      folders: [],
    },
    exportedAt,
  );
}

export interface NativeFiles {
  characters: Array<{ card: CardDraft; envelope: NativeEnvelope }>;
  persona: NativeEnvelope | null;
  lorebooks: Array<{ lorebook: LorebookDraft; envelope: NativeEnvelope }>;
}

export function toNative(pkg: AdventurePackage, exportedAt = new Date().toISOString()): NativeFiles {
  return {
    characters: pkg.characters.map((card) => ({ card, envelope: nativeCharacter(card, pkg.title, exportedAt) })),
    persona: pkg.persona ? nativePersona(pkg.persona, exportedAt) : null,
    lorebooks: pkg.lorebooks.map((lorebook) => ({ lorebook, envelope: nativeLorebook(lorebook, pkg.title, exportedAt) })),
  };
}
