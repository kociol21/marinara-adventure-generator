import { createHash } from "node:crypto";
import { AUDIT_AREA_LABELS, type AdventurePackage, type AuditReportView } from "@adv/shared";
import { GENERATOR_NAME, slugify, toNative, type NativeEnvelope } from "./native.ts";
import { validatePackage, type PackageIssue } from "./validate.ts";
export type { PackageIssue };
import { createZip, type ZipFile } from "./zip.ts";
import packageJson from "../../package.json" with { type: "json" };

export interface ExportResult {
  /** Folder name used inside the zip and for the download. */
  slug: string;
  files: ZipFile[];
  manifest: ExportManifest;
  issues: PackageIssue[];
}

export interface ExportManifest {
  generator: string;
  generatorVersion: string;
  format: "marinara-native-v1";
  title: string;
  createdAt: string;
  files: Array<{ path: string; kind: "character" | "persona" | "lorebook" | "guide"; sha256: string }>;
  counts: { characters: number; personas: number; lorebooks: number; lorebookEntries: number };
  /** Spec §8: configured settings are not the same as vectors built in Marinara. */
  vectors: Array<{ lorebook: string; status: "configured-not-built" | "off" }>;
  /** What a file export cannot do; Push to Marinara covers these. */
  notIncluded: string[];
  validation: { errors: number; warnings: number };
}

export class ExportBlockedError extends Error {
  constructor(readonly issues: PackageIssue[]) {
    super(`Export blocked by ${issues.filter((i) => i.severity === "error").length} validation error(s).`);
  }
}

const safeFileName = (name: string) => slugify(name, 40);

function uniquePath(used: Set<string>, base: string): string {
  let path = base;
  for (let n = 2; used.has(path); n++) path = base.replace(/(\.marinara\.json)$/, `-${n}$1`);
  used.add(path);
  return path;
}

const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

/**
 * Builds the export bundle (spec §5): native Marinara files, a spoiler-free start guide and a
 * manifest. Structural validation runs first and errors block the export (spec §14: the app,
 * not the model, enforces checks before export). Secret Plot is never written to files.
 */
/** Spoiler-free QA report for the bundle (spec §5.8, §12): status, scope, findings by place, limits. */
export function qaReport(pkg: AdventurePackage, audit: AuditReportView | null, issues: PackageIssue[]): string {
  const lines = [`# Quality report: ${pkg.title}`, ""];
  if (!audit) {
    lines.push("The quality audit has not run for this package. Only structural validation was done.", "");
  } else {
    const major = audit.findings.filter((f) => f.severity === "major").length;
    lines.push(
      `Status: ${audit.findings.length === 0 ? "no open findings" : `${audit.findings.length} open findings (${major} major)`}.`,
      `Automatic fix rounds used: ${audit.fixRounds} of ${audit.maxFixRounds}.`,
      "",
      "Findings below name only places you can see (cards, lorebooks, the teaser) and never quote hidden content.",
      "Model-based checks are heuristic: no findings does not prove there are no contradictions or spoilers.",
      "",
      "## Checked",
      "",
      ...audit.checked.map((c) => `- ${c}`),
      "",
      "## Not checked",
      "",
      ...audit.notChecked.map((c) => `- ${c}`),
      "",
    );
    if (audit.findings.length) {
      lines.push("## Open findings", "");
      for (const f of audit.findings) lines.push(`- **${f.severity}** · ${AUDIT_AREA_LABELS[f.area]} · ${f.summary}${f.source === "model" ? " _(model review)_" : ""}`);
      lines.push("");
    }
  }
  const warnings = issues.filter((i) => i.severity !== "error");
  if (warnings.length) {
    lines.push("## Validation notes", "", ...warnings.map((i) => `- ${i.summary}`), "");
  }
  return lines.join("\n");
}

export function buildExport(pkg: AdventurePackage, createdAt = new Date().toISOString(), audit: AuditReportView | null = null): ExportResult {
  const issues = validatePackage(pkg);
  if (issues.some((i) => i.severity === "error")) throw new ExportBlockedError(issues);

  const slug = slugify(pkg.title, 40);
  const native = toNative(pkg, createdAt);
  const used = new Set<string>();
  const files: ZipFile[] = [];
  const manifestFiles: ExportManifest["files"] = [];
  const add = (path: string, data: Buffer, kind: ExportManifest["files"][number]["kind"]) => {
    files.push({ path: `${slug}/${path}`, data });
    manifestFiles.push({ path, kind, sha256: createHash("sha256").update(data).digest("hex") });
  };
  const addEnvelope = (dir: string, name: string, env: NativeEnvelope, kind: "character" | "persona" | "lorebook") =>
    add(uniquePath(used, `${dir}/${safeFileName(name)}.marinara.json`), json(env), kind);

  add("START-HERE.md", Buffer.from(startGuide(pkg), "utf8"), "guide");
  add("qa-report.md", Buffer.from(qaReport(pkg, audit, issues), "utf8"), "guide");
  for (const { card, envelope } of native.characters) addEnvelope("characters", card.name, envelope, "character");
  if (native.persona && pkg.persona) addEnvelope("persona", pkg.persona.name, native.persona, "persona");
  for (const { lorebook, envelope } of native.lorebooks) addEnvelope("lorebooks", lorebook.name, envelope, "lorebook");

  const manifest: ExportManifest = {
    generator: GENERATOR_NAME,
    generatorVersion: packageJson.version,
    format: "marinara-native-v1",
    title: pkg.title,
    createdAt,
    files: [...manifestFiles],
    counts: {
      characters: pkg.characters.length,
      personas: pkg.persona ? 1 : 0,
      lorebooks: pkg.lorebooks.length,
      lorebookEntries: pkg.lorebooks.reduce((n, lb) => n + lb.entries.length, 0),
    },
    vectors: pkg.lorebooks.map((lb) => ({ lorebook: lb.name, status: lb.vectors.enabled ? "configured-not-built" : "off" })),
    notIncluded: [
      "Secret Plot (Narrative Director memory lives in a chat; use Push to Marinara)",
      "Lorebook vectors (Marinara builds them after import)",
      "Links between lorebooks and the chat (add them in Chat Settings)",
    ],
    validation: {
      errors: 0,
      warnings: issues.filter((i) => i.severity === "warning").length,
    },
  };
  files.push({ path: `${slug}/manifest.json`, data: json(manifest) });

  return { slug, files, manifest, issues };
}

export function buildExportZip(pkg: AdventurePackage, audit: AuditReportView | null = null): { fileName: string; zip: Buffer; result: ExportResult } {
  const result = buildExport(pkg, undefined, audit);
  return { fileName: `${result.slug}.zip`, zip: createZip(result.files), result };
}

/** Player-facing instructions. Uses only what the player may know: title, teaser, card names, lorebook names. */
export function startGuide(pkg: AdventurePackage): string {
  const opening = pkg.characters.find((c) => c.key === pkg.openingCardKey);
  const vectorBooks = pkg.lorebooks.filter((lb) => lb.vectors.enabled);
  const lines = [
    `# ${pkg.title}`,
    "",
    pkg.teaser.trim(),
    "",
    "This folder holds everything Marinara Engine needs. The files contain the hidden story; you do not need to open them.",
    "",
    "## 1. Import",
    "",
    "1. **Characters** panel → **Import** → drop every file from `characters/`.",
    "   Keep **Imported card tags** on **All tags** (the default). Some lore is tied to the characters' tags.",
    ...(pkg.persona ? ["2. **Personas** panel → **Import** → the file in `persona/`."] : []),
    `${pkg.persona ? 3 : 2}. **Lorebooks** panel → **Import** → every file from \`lorebooks/\`.`,
    "",
    "## 2. Start the chat",
    "",
    `1. Create a **Roleplay** chat with: ${pkg.characters.map((c) => `**${c.name}**`).join(", ")}.`,
    `2. ${pkg.persona ? `Select the persona **${pkg.persona.name}**.` : "Select your own persona."}`,
    `3. Open **Chat Settings → Lorebooks → Add Lorebook** and add: ${pkg.lorebooks.map((lb) => `**${lb.name}**`).join(", ")}.`,
    "   Do not make them Global; they belong to this adventure only.",
    `4. The opening scene is ${opening ? `**${opening.name}**'s` : "the first"} greeting. If Marinara asks which greeting to use, keep that one.`,
    "",
    ...(vectorBooks.length
      ? [
          "## 3. Semantic search",
          "",
          `These lorebooks are prepared for meaning-based matching: ${vectorBooks.map((lb) => `**${lb.name}**`).join(", ")}.`,
          "Open each one → **Overview** → **Semantic Search** → pick the embedding source you use in chat → **Vectorize**.",
          "Use the same embedding source for vectorizing and for chatting. Keyword matching works without this step.",
          "",
        ]
      : []),
    "## Not in these files",
    "",
    "- The Narrative Director's Secret Plot. The generator can set it up for you with **Push to Marinara**; otherwise the Director writes its own arc as you play.",
    "- Built vectors (see above, if any).",
    "",
    `Made with ${GENERATOR_NAME}.`,
    "",
  ];
  return lines.join("\n");
}
