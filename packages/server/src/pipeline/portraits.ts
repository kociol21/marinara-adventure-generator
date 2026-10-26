import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { PORTRAIT_STYLES, type PortraitSettings, type Requirements } from "@adv/shared";

export interface PortraitSubject {
  name: string;
  appearance: string;
  /** Short image tags; preferred over Appearance when set (as in Marinara's own avatar generator). */
  imageAppearance?: string | undefined;
}

export interface PortraitOutput {
  /** Path relative to the portraits directory. */
  file: string;
  sha256: string;
  width: number;
  height: number;
}

/**
 * The portrait prompt is built by code from the character's fields and the chosen style. The player
 * sees the portrait, so it shows only what anyone would see at a first meeting.
 */
export function portraitPrompt(r: Requirements, settings: PortraitSettings, subject: PortraitSubject): string {
  const style =
    settings.style === "auto"
      ? r.visualStyle || `illustration fitting a ${r.genre || "story"} set in ${r.setting.era || "its era"}`
      : PORTRAIT_STYLES[settings.style].prompt;
  const look = subject.imageAppearance?.trim() || subject.appearance.trim();
  return [
    `Character portrait for a roleplay character card: ${subject.name}.`,
    `Style: ${style}.${settings.notes ? ` ${settings.notes}.` : ""}`,
    `Appearance: ${look}`,
    `Setting: ${[r.setting.era, r.setting.place].filter(Boolean).join(", ")}.`,
    "Head and shoulders, facing the viewer, neutral background, square composition (1:1), the face clearly visible.",
    "Show only what anyone would see on first meeting this person: no blood, wounds, weapons in use or props that hint at hidden events.",
    "No text, letters, logos, watermark or frame.",
  ].join("\n");
}

/** Part of each portrait stage's version, so a style change re-renders only the portraits. */
export function portraitSettingsKey(settings: PortraitSettings): string {
  return `p1-${createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 12)}`;
}

export async function savePortrait(dir: string, projectId: string, name: string, png: Buffer): Promise<{ file: string; sha256: string }> {
  const sha256 = createHash("sha256").update(png).digest("hex");
  const file = join(projectId, `${name.replace(/[^a-z0-9-]/gi, "-")}-${sha256.slice(0, 12)}.png`);
  await mkdir(join(dir, projectId), { recursive: true });
  await writeFile(join(dir, file), png);
  return { file, sha256 };
}

/** The stored PNG stays the original; exports embed WebP, which Marinara's importer accepts and is several times smaller. */
export async function portraitDataUrl(dir: string, output: PortraitOutput): Promise<string> {
  const webp = await sharp(join(dir, output.file)).webp({ quality: 86 }).toBuffer();
  return `data:image/webp;base64,${webp.toString("base64")}`;
}
