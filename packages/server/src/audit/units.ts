import type { AdventurePackage, AuditArea, AuditSeverity } from "@adv/shared";

/** One piece of text in the package, with the stage that wrote it (the place to fix it). */
export interface TextUnit {
  id: string;
  /** Spoiler-free label of where it lives. */
  where: string;
  /** Pipeline stage that produced it; the target of a fix. */
  stage: string;
  kind: "card-field" | "example" | "first-message" | "persona-field" | "entry" | "entry-name" | "teaser" | "opening" | "name" | "tag";
  /** The player sees this before or during play (names, tags, teaser, persona, greetings). */
  visible: boolean;
  text: string;
}

export interface AuditFinding {
  id: string;
  area: AuditArea;
  severity: AuditSeverity;
  source: "code" | "model";
  /** Stage to regenerate with a fix note, or null when no single stage can fix it. */
  target: string | null;
  where: string;
  /** Spoiler-free, built by code. */
  summary: string;
  /** May contain hidden content. */
  detail: string;
  /** Instruction for the stage that fixes it (hidden content allowed). */
  fix: string | null;
}

export interface AuditOutput {
  findings: AuditFinding[];
  checked: string[];
  notChecked: string[];
}

const CARD_FIELDS = ["description", "personality", "backstory", "appearance", "scenario"] as const;

/** Labels name only what the player may see: card names, lorebook names, entry numbers. */
export function textUnits(pkg: AdventurePackage): TextUnit[] {
  const units: TextUnit[] = [];
  for (const card of pkg.characters) {
    const stage = `card:${card.key}`;
    const where = `Card: ${card.name}`;
    units.push({ id: `${stage}:name`, where, stage, kind: "name", visible: true, text: card.name });
    for (const tag of card.tags) units.push({ id: `${stage}:tag:${tag}`, where, stage, kind: "tag", visible: true, text: tag });
    for (const field of CARD_FIELDS) {
      units.push({ id: `${stage}:${field}`, where: `${where} (${field})`, stage, kind: "card-field", visible: false, text: card[field] });
    }
    units.push({ id: `${stage}:example`, where: `${where} (example dialogue)`, stage, kind: "example", visible: false, text: card.exampleDialogue });
    if (card.key === pkg.openingCardKey) {
      units.push({ id: "opening", where: "Opening scene", stage: "opening", kind: "opening", visible: true, text: card.firstMessage });
    } else if (card.firstMessage.trim()) {
      units.push({ id: `${stage}:first`, where: `${where} (first message)`, stage, kind: "first-message", visible: true, text: card.firstMessage });
    }
  }
  if (pkg.persona) {
    for (const field of [...CARD_FIELDS, "exampleDialogue"] as const) {
      const text = pkg.persona[field];
      if (text?.trim()) units.push({ id: `persona:${field}`, where: `Persona (${field})`, stage: "persona", kind: "persona-field", visible: true, text });
    }
  }
  units.push({ id: "teaser", where: "Teaser", stage: "opening", kind: "teaser", visible: true, text: pkg.teaser });
  for (const lb of pkg.lorebooks) {
    const stage = `lorebook:${lb.key}`;
    lb.entries.forEach((entry, i) => {
      const where = `Lorebook: ${lb.name}, entry #${i + 1}`;
      // Code-built entries (the narrative voice) have no stage to fix.
      const owner = entry.key === "narrative-voice" ? "assemble" : stage;
      units.push({ id: `${stage}:${entry.key}`, where, stage: owner, kind: "entry", visible: false, text: entry.content });
      // Entry names and keys show in Marinara's lorebook editor; a curious player may open it.
      units.push({ id: `${stage}:${entry.key}:name`, where, stage: owner, kind: "entry-name", visible: true, text: [entry.name, ...entry.keys].join(" | ") });
    });
  }
  return units.filter((u) => u.text.trim().length > 0);
}
