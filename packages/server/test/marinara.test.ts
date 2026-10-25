import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adventurePackageSchema, type AdventurePackage } from "@adv/shared";
import { nativeCharacter, nativeLorebook, privateTag, toNative } from "../src/marinara/native.ts";
import { validatePackage } from "../src/marinara/validate.ts";
import { buildExport, buildExportZip, ExportBlockedError } from "../src/marinara/export.ts";
import { createZip } from "../src/marinara/zip.ts";
import { simulateActivation, testKeyword } from "../src/marinara/simulate.ts";
import { estimateTokens } from "../src/marinara/tokens.ts";
import { probeInput, probePackage } from "./fixtures/probe-package.ts";
import { readZip } from "./zip-reader.ts";

const clone = (): AdventurePackage => structuredClone(probePackage);
const codes = (pkg: AdventurePackage) => validatePackage(pkg).map((i) => `${i.severity}:${i.code}`);

describe("native mapping", () => {
  it("maps card fields to Marinara's V2 card with backstory and appearance in extensions", () => {
    const env = nativeCharacter(probePackage.characters[0]!, probePackage.title, "2026-10-25T00:00:00.000Z");
    expect(env).toMatchObject({ type: "marinara_character", version: 1 });
    const data = (env.data as { data: Record<string, any> }).data;
    expect(data).toMatchObject({
      name: "Probe Alpha",
      description: "ALPHA_DESCRIPTION",
      personality: "ALPHA_PERSONALITY",
      scenario: "ALPHA_SCENARIO",
      first_mes: "ALPHA_FIRST_MESSAGE",
      extensions: { backstory: "ALPHA_BACKSTORY", appearance: "ALPHA_APPEARANCE" },
    });
    expect(data.tags).toContain("adv-probe-harbor-alpha");
  });

  it("filters private entries by card tag and never by id", () => {
    const env = nativeLorebook(probePackage.lorebooks[1]!, probePackage.title, "t");
    const data = env.data as { lorebook: Record<string, unknown>; entries: Array<Record<string, unknown>> };
    const priv = data.entries.find((e) => e.name === "Alpha private")!;
    expect(priv).toMatchObject({
      characterTagFilterMode: "include",
      characterTagFilters: [privateTag(probePackage.title, "alpha")],
      characterFilterIds: [],
    });
    expect(data.lorebook).toMatchObject({ isGlobal: false, characterIds: [], personaIds: [], recursiveScanning: true });
  });

  it("maps entry types, logic and positions to Marinara's stored values", () => {
    const entries = (nativeLorebook(probePackage.lorebooks[0]!, "t", "t").data as { entries: Array<Record<string, any>> }).entries;
    const by = (n: string) => entries.find((e) => e.name === n)!;
    expect(by("Premise")).toMatchObject({ constant: true, selective: false, position: 0 });
    expect(by("Harbor king")).toMatchObject({ selective: true, selectiveLogic: "and", matchWholeWords: true });
    expect(by("Calm sea")).toMatchObject({ selectiveLogic: "not" });
    expect(by("Lighthouse")).toMatchObject({ preventRecursion: true, excludeFromVectorization: false, decisionMode: "off" });
  });

  it("never writes the Secret Plot into native files", () => {
    const pkg = { ...clone(), secretPlot: { description: "SECRET_ARC", protagonistArc: "SECRET_PROTAGONIST", sceneDirections: [] } };
    expect(JSON.stringify(toNative(pkg))).not.toContain("SECRET_ARC");
  });
});

describe("validation", () => {
  it("accepts the probe package without errors", () => {
    expect(codes(probePackage).filter((c) => c.startsWith("error"))).toEqual([]);
  });

  it("enforces the card limit and references", () => {
    const pkg = clone();
    pkg.maxNpcCards = 1;
    pkg.openingCardKey = "nobody";
    pkg.lorebooks[1]!.entries[0]!.privateTo = ["ghost"];
    expect(codes(pkg)).toEqual(expect.arrayContaining(["error:card-limit", "error:opening-card", "error:unknown-private-card"]));
  });

  it("finds entries that can never fire and risky keys", () => {
    const pkg = clone();
    const entries = pkg.lorebooks[0]!.entries;
    entries.push({ ...entries[1]!, key: "dead", keys: [], type: "normal" });
    entries.push({ ...entries[1]!, key: "broad", keys: ["the"] });
    entries.push({ ...entries[1]!, key: "tiny", keys: ["ox"] });
    entries.push({ ...entries[1]!, key: "badre", keys: ["(unclosed"], useRegex: true });
    expect(codes(pkg)).toEqual(
      expect.arrayContaining(["error:no-activation", "warning:broad-key", "error:key-too-short", "error:invalid-regex"]),
    );
  });

  it("keeps spoilers out of summaries", () => {
    const pkg = clone();
    pkg.lorebooks[1]!.entries[0]!.keys = [];
    pkg.lorebooks[1]!.entries[0]!.name = "The butler did it";
    const issue = validatePackage(pkg).find((i) => i.code === "no-activation")!;
    expect(issue.summary).not.toContain("butler");
    expect(issue.detail).toContain("butler");
  });

  it("checks constant budgets with Marinara's token estimate", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    const pkg = clone();
    pkg.lorebooks[0]!.tokenBudget = 10;
    pkg.lorebooks[0]!.entries[0]!.content = "x".repeat(200);
    expect(codes(pkg)).toEqual(expect.arrayContaining(["error:entry-over-budget", "error:constant-over-budget"]));
  });
});

describe("export bundle", () => {
  it("writes native files, a spoiler-free guide and a manifest", () => {
    const pkg = { ...clone(), secretPlot: { description: "SECRET_ARC", protagonistArc: "P", sceneDirections: [] } };
    const { zip, fileName } = buildExportZip(pkg);
    expect(fileName).toBe("probe-harbor.zip");
    const files = readZip(zip);
    expect([...files.keys()].sort()).toEqual([
      "probe-harbor/START-HERE.md",
      "probe-harbor/characters/probe-alpha.marinara.json",
      "probe-harbor/characters/probe-beta.marinara.json",
      "probe-harbor/lorebooks/probe-plot.marinara.json",
      "probe-harbor/lorebooks/probe-world.marinara.json",
      "probe-harbor/manifest.json",
      "probe-harbor/persona/probe-persona.marinara.json",
      "probe-harbor/qa-report.md",
    ]);
    const all = [...files.values()].map((b) => b.toString("utf8")).join("\n");
    expect(all).not.toContain("SECRET_ARC");

    const guide = files.get("probe-harbor/START-HERE.md")!.toString("utf8");
    expect(guide).toContain("All tags");
    expect(guide).not.toMatch(/PLOT_|WORLD_|ALPHA_/);

    const manifest = JSON.parse(files.get("probe-harbor/manifest.json")!.toString("utf8"));
    expect(manifest.counts).toEqual({ characters: 2, personas: 1, lorebooks: 2, lorebookEntries: 13 });
    expect(manifest.vectors.every((v: { status: string }) => v.status === "off")).toBe(true);
  });

  it("blocks export on validation errors", () => {
    const pkg = clone();
    pkg.maxNpcCards = 1;
    expect(() => buildExport(pkg)).toThrow(ExportBlockedError);
  });

  it("produces a zip that the operating system can extract", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const zipPath = join(dir, "t.zip");
    writeFileSync(zipPath, createZip([{ path: "a/hello.txt", data: Buffer.from("hello ".repeat(100)) }, { path: "b.bin", data: Buffer.from([1, 2, 3]) }]));
    const out = join(dir, "out");
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${out}'`]);
    } else {
      execFileSync("unzip", ["-q", zipPath, "-d", out]);
    }
    expect(readFileSync(join(out, "a", "hello.txt"), "utf8")).toBe("hello ".repeat(100));
    expect(readdirSync(out).sort()).toEqual(["a", "b.bin"]);
  });
});

describe("activation simulator", () => {
  const sim = (cards: string[], messages: string[], extra = {}) => {
    const result = simulateActivation(
      probePackage,
      messages.map((content) => ({ role: "user" as const, content })),
      { activeCardKeys: cards, ...extra },
    );
    return new Set(result.entries.filter((e) => e.status === "activated").map((e) => e.entryKey));
  };

  it("matches whole words with Unicode boundaries like Marinara", () => {
    expect(testKeyword("Ash", "Ash waits", { matchWholeWords: true, caseSensitive: false, useRegex: false })).toBe(true);
    expect(testKeyword("Ash", "cash only", { matchWholeWords: true, caseSensitive: false, useRegex: false })).toBe(false);
    expect(testKeyword("Ash", "żAsh", { matchWholeWords: true, caseSensitive: false, useRegex: false })).toBe(false);
  });

  it("keeps private entries to their card", () => {
    expect(sim(["alpha"], ["To the lighthouse."]).has("alpha-secret")).toBe(true);
    expect(sim(["beta"], ["To the lighthouse."]).has("alpha-secret")).toBe(false);
  });

  it("applies selective logic, groups, case, regex, recursion and scan depth", () => {
    expect(sim(["alpha"], ["The king walks the harbor."]).has("harbor-king")).toBe(true);
    expect(sim(["alpha"], ["The king is tired."]).has("harbor-king")).toBe(false);
    expect(sim(["alpha"], ["The sea, a storm coming."]).has("no-storm")).toBe(false);
    const rumors = sim(["alpha"], ["A rumor."]);
    expect(rumors.has("rumor-a") && !rumors.has("rumor-b")).toBe(true);
    expect(sim(["alpha"], ["A ship sails."]).has("case-ship")).toBe(false);
    expect(sim(["alpha"], ["At the docks."]).has("regex-dock")).toBe(true);
    const chain = sim(["alpha"], ["Check the ledger."]);
    expect(chain.has("chain-start") && chain.has("chain-end")).toBe(true);
    // World scans 2 messages, Plot scans 4.
    const deep = sim(["alpha"], ["The lighthouse.", "Two.", "Three."]);
    expect(deep.has("lighthouse")).toBe(false);
    expect(deep.has("alpha-secret")).toBe(true);
  });

  it("applies delays only when a message index is given", () => {
    expect(sim(["alpha"], ["lighthouse"]).has("late")).toBe(true);
    expect(sim(["alpha"], ["lighthouse"], { messageIndex: 2 }).has("late")).toBe(false);
    expect(sim(["alpha"], ["lighthouse"], { messageIndex: 5 }).has("late")).toBe(true);
  });

  it("trims to budgets with constants first", () => {
    const pkg = adventurePackageSchema.parse(probeInput);
    pkg.lorebooks[0]!.tokenBudget = 6;
    const result = simulateActivation(pkg, [{ role: "user", content: "lighthouse and the beacon" }], { activeCardKeys: ["alpha"] });
    const by = (k: string) => result.entries.find((e) => e.entryKey === k)!;
    expect(by("premise").budget).toBe("selected");
    expect(by("lighthouse").budget).toBe("lorebook-budget");
  });
});
