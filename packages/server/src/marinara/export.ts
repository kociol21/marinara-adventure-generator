import { createHash } from "node:crypto";
import { AUDIT_AREA_LABELS, type AdventurePackage, type AuditReportView, type ExportManifest, type Requirements } from "@adv/shared";
export type { ExportManifest };
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

export interface ExportOptions {
  createdAt?: string;
  audit?: AuditReportView | null;
  requirements?: Requirements | null;
  requirementsApprovedAt?: string | null;
  /** Vision-check result per card key (and "persona"); absent keys have no portrait. */
  portraitChecks?: Record<string, "match" | "mismatch" | "unchecked">;
  /** Stored key and token values; any of them in a file blocks the export (criterion 12). */
  secretValues?: string[];
}

export class ExportBlockedError extends Error {
  constructor(readonly issues: PackageIssue[]) {
    super(`Export blocked by ${issues.filter((i) => i.severity === "error").length} validation error(s).`);
  }
}

/** Raised when a file would carry a key or token. Names no secret, only that one was found. */
export class SecretLeakError extends Error {
  constructor(readonly paths: string[]) {
    super(`Export blocked: ${paths.length} file(s) contain something that looks like a stored key or token.`);
  }
}

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI-style API keys (base64 avatars contain no "-")
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT access tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
];

/** Paths of files that contain a known secret value or something shaped like a token. */
export function findSecretLeaks(files: ZipFile[], secretValues: string[] = []): string[] {
  const known = secretValues.map((v) => v.trim()).filter((v) => v.length >= 8);
  return files
    .filter((f) => {
      const text = f.data.toString("utf8");
      return known.some((v) => text.includes(v)) || TOKEN_PATTERNS.some((re) => re.test(text));
    })
    .map((f) => f.path);
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

export function buildExport(pkg: AdventurePackage, options: ExportOptions = {}): ExportResult {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const audit = options.audit ?? null;
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
  if (options.requirements) add("requirements.md", Buffer.from(requirementsSheet(pkg, options.requirements), "utf8"), "guide");
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
    requirementsApprovedAt: options.requirementsApprovedAt ?? null,
    files: [...manifestFiles],
    counts: {
      characters: pkg.characters.length,
      personas: pkg.persona ? 1 : 0,
      lorebooks: pkg.lorebooks.length,
      lorebookEntries: pkg.lorebooks.reduce((n, lb) => n + lb.entries.length, 0),
    },
    vectors: pkg.lorebooks.map((lb) => ({
      lorebook: lb.name,
      status: lb.vectors.enabled ? "configured-not-built" : "off",
      configured: lb.vectors.enabled,
      built: false,
      verifiedInGame: false,
    })),
    portraits: [
      ...pkg.characters.map((c) => ({ name: c.name, included: !!c.avatar, check: c.avatar ? (options.portraitChecks?.[c.key] ?? null) : null })),
      ...(pkg.persona
        ? [{ name: pkg.persona.name, included: !!pkg.persona.avatar, check: pkg.persona.avatar ? (options.portraitChecks?.persona ?? null) : null }]
        : []),
    ],
    audit: {
      ran: !!audit,
      openFindings: audit?.findings.length ?? 0,
      major: audit?.findings.filter((f) => f.severity === "major").length ?? 0,
      fixRounds: audit?.fixRounds ?? 0,
      maxFixRounds: audit?.maxFixRounds ?? 0,
    },
    secretPlot: "not-included",
    notIncluded: [
      "Secret Plot (Narrative Director memory lives in a chat; use Push to Marinara)",
      ...(pkg.lorebooks.some((lb) => lb.vectors.enabled) ? ["Lorebook vectors (Marinara builds them after import)"] : []),
      "Links between lorebooks and the chat (add them in the roleplay setup or Chat Settings)",
    ],
    validation: {
      errors: 0,
      warnings: issues.filter((i) => i.severity === "warning").length,
    },
  };
  files.push({ path: `${slug}/manifest.json`, data: json(manifest) });

  const leaks = findSecretLeaks(files, options.secretValues);
  if (leaks.length) throw new SecretLeakError(leaks);
  return { slug, files, manifest, issues };
}

export function buildExportZip(pkg: AdventurePackage, options: ExportOptions = {}): { fileName: string; zip: Buffer; result: ExportResult } {
  const result = buildExport(pkg, options);
  return { fileName: `${result.slug}.zip`, zip: createZip(result.files), result };
}

const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** The approved requirements (spec §5.1): only what the player said or accepted, so nothing hidden. */
export function requirementsSheet(pkg: AdventurePackage, r: Requirements): string {
  const lines = [`# ${pkg.title}: requirements`, "", pkg.teaser.trim(), "", "What you asked for when this adventure was planned.", ""];
  const walk = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      if (value.length) lines.push(`- **${path.map(label).join(" › ")}:** ${value.join("; ")}`);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
    } else if (value !== "" && value !== null && value !== undefined) {
      lines.push(`- **${path.map(label).join(" › ")}:** ${String(value)}`);
    }
  };
  walk(r, []);
  lines.push("");
  return lines.join("\n");
}

/**
 * Player-facing instructions. Uses only what the player may know: title, teaser, card names, lorebook
 * names. UI paths follow Marinara 2.5.1 (checked against its client): the roleplay setup posts every
 * added card's first message, which is why only the opening card has one.
 */
export function startGuide(pkg: AdventurePackage): string {
  const opening = pkg.characters.find((c) => c.key === pkg.openingCardKey);
  const ordered = opening ? [opening, ...pkg.characters.filter((c) => c !== opening)] : pkg.characters;
  const vectorBooks = pkg.lorebooks.filter((lb) => lb.vectors.enabled);
  const bold = (names: string[]) => names.map((n) => `**${n}**`).join(", ");
  const lines = [
    `# ${pkg.title}`,
    "",
    pkg.teaser.trim(),
    "",
    "This folder holds everything Marinara Engine needs. The character, persona and lorebook files contain the hidden story; you do not need to open them.",
    "`requirements.md` (what you asked for) and `qa-report.md` (the spoiler-free quality report) are safe to read.",
    "",
    "## 1. Import",
    "",
    "1. **Characters** panel → **Import** → drop every file from `characters/`.",
    "   Keep **Imported card tags** on **All tags** (the default): some lore is tied to the characters' tags.",
    ...(pkg.persona ? ["2. **Personas** panel → **Import** → the file in `persona/`."] : []),
    `${pkg.persona ? 3 : 2}. **Lorebooks** panel → **Import** → every file from \`lorebooks/\`.`,
    "",
    "## 2. Start the chat",
    "",
    "1. **Home** → **Roleplay**. In the chat setup:",
    `   - **Characters**: add ${bold(ordered.map((c) => c.name))}.${opening ? ` Only ${opening.name} has a greeting: it is the opening scene.` : ""}`,
    `   - **Your Persona**: ${pkg.persona ? `**${pkg.persona.name}**` : "your own persona"}.`,
    `   - **Lorebooks**: add ${bold(pkg.lorebooks.map((lb) => lb.name))}. Do not make them Global; they belong to this adventure only.`,
    "2. Finish the setup. If you skipped the lorebooks there, add them later in **Chat Settings → Lorebooks → Add Lorebook**.",
    "",
    ...(vectorBooks.length
      ? [
          "## 3. Semantic search",
          "",
          `These lorebooks are prepared for meaning-based matching: ${bold(vectorBooks.map((lb) => lb.name))}.`,
          "Open each one → **Overview** → **Semantic Search (Embeddings)** → choose a connection with an embedding model → **Vectorize**.",
          "Use the same embedding source for vectorizing and for chatting. Keyword matching works without this step.",
          "",
        ]
      : []),
    `## ${vectorBooks.length ? 4 : 3}. Narrative Director (optional)`,
    "",
    "The Narrative Director agent steers pacing and threads with a hidden Secret Plot. **Push to Marinara** in the generator sets that plot up from this adventure.",
    "With these files alone you can still turn it on: **Chat Settings → Agents → Enable Agents → Add Agent → Narrative Director** (if it is missing, download it in the **Agents** panel first).",
    "It then writes its own plot as you play. Its **Secret Plot** panel shows that plot, so leave it closed to avoid spoilers.",
    "",
    "## Not in these files",
    "",
    "- The Secret Plot prepared for this adventure (see above).",
    ...(vectorBooks.length ? ["- Built vectors (see Semantic search)."] : []),
    "",
    `Made with ${GENERATOR_NAME}.`,
    "",
  ];
  return lines.join("\n");
}
