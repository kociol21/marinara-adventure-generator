import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { adventurePackageSchema, requirementsSchema, type GenerationState } from "@adv/shared";
import { buildApp } from "../src/app.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { MemorySecretStore } from "../src/secrets/secret-store.ts";
import type { Pipeline } from "../src/pipeline/runner.ts";
import { findDuplicates, findSpoilers, findUnreachableClues } from "../src/audit/code-checks.ts";
import { toFindings } from "../src/audit/review.ts";
import { textUnits } from "../src/audit/units.ts";
import { factSchema, lorebookOutputSchema, planSchema } from "../src/pipeline/schemas.ts";
import { checkClueEntries } from "../src/pipeline/stages.ts";
import { fakeFetch, type RecordedRequest } from "./fake-fetch.ts";
import { readZip } from "./zip-reader.ts";
import { probeInput } from "./fixtures/probe-package.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const LONG = "the lighthouse keeper rows across the black water every night at nine to light the lamp himself";

function pkgWith(mut: (p: typeof probeInput) => void) {
  const input = structuredClone(probeInput);
  mut(input);
  return adventurePackageSchema.parse(input);
}

describe("code checks", () => {
  it("find a passage copied between a card and a lorebook entry, and target the lorebook", () => {
    const pkg = pkgWith((p) => {
      p.characters[0]!.backstory = `Alpha grew up by the sea. ${LONG}.`;
      p.lorebooks[0]!.entries[1]!.content = `Old story: ${LONG}, they say.`;
    });
    const dups = findDuplicates(textUnits(pkg));
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ area: "duplicates", target: "lorebook:world", source: "code" });
    expect(dups[0]!.summary).not.toContain("lighthouse keeper");
    expect(dups[0]!.fix).toContain("Card: Probe Alpha (backstory)");
  });

  it("do not flag distinct texts", () => {
    expect(findDuplicates(textUnits(adventurePackageSchema.parse(probeInput)))).toEqual([]);
  });

  it("flag secrets echoed in visible text and give-away words in tags", () => {
    const secret = factSchema.parse({
      id: "f1",
      subject: "alpha",
      statement: "Alpha poisoned the harbormaster with nightshade tea last winter",
      layer: "truth",
      secrecy: "secret",
      home: { kind: "lorebook", lorebook: "plot" },
    });
    const pkg = pkgWith((p) => {
      p.teaser = "Someone poisoned the harbormaster with nightshade tea.";
      p.characters[1]!.tags = ["probe", "the killer"];
    });
    const found = findSpoilers(textUnits(pkg), [secret]);
    const where = found.map((f) => `${f.where}:${f.severity}`);
    expect(where).toContain("Teaser:major");
    expect(where).toContain("Card: Probe Beta:major");
    expect(found.every((f) => !f.summary.includes("nightshade"))).toBe(true);
  });

  it("find clues that do not surface when their place comes up", () => {
    const pkg = pkgWith((p) => {
      p.lorebooks[1]!.entries[1]!.factIds = ["f9"]; // "Chain start", keyed on "ledger" only
    });
    const plan = planSchema.parse({ ...fixture.plan, entities: [...fixture.plan.entities, { key: "pier", type: "location", name: "Old Pier", publicDescription: "A pier." }] });
    const clues = {
      conclusions: [{ id: "c1", statement: "x", factIds: [] }],
      clues: [{ id: "k1", conclusionId: "c1", where: "pier", how: "found under the planks", factId: "f9" }],
      redHerrings: [],
    };
    const found = findUnreachableClues(pkg, plan, clues);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ area: "activation", severity: "major", target: "lorebook:plot" });
    expect(found[0]!.fix).toContain('add "Old Pier"');
  });

  it("accept a selective clue entry that waits for its place plus a second word", () => {
    const plan = planSchema.parse({ ...fixture.plan, entities: [...fixture.plan.entities, { key: "pier", type: "location", name: "Old Pier", publicDescription: "A pier." }] });
    const clues = {
      conclusions: [{ id: "c1", statement: "x", factIds: [] }],
      clues: [{ id: "k1", conclusionId: "c1", where: "pier", how: "under the planks", factId: "f9" }],
      redHerrings: [],
    };
    const selective = pkgWith((p) => {
      p.lorebooks[1]!.entries[1] = {
        ...p.lorebooks[1]!.entries[1]!,
        type: "selective",
        keys: ["Old Pier"],
        secondaryKeys: ["planks", "search"],
        selectiveLogic: "and_any",
        factIds: ["f9"],
      };
    });
    expect(findUnreachableClues(selective, plan, clues)).toEqual([]);
    const blocked = pkgWith((p) => {
      p.lorebooks[1]!.entries[1] = { ...p.lorebooks[1]!.entries[1]!, keys: ["ledger"], factIds: ["f9"] };
    });
    expect(findUnreachableClues(blocked, plan, clues)).toHaveLength(1);
  });

  it("write model finding summaries in code and drop unknown targets", () => {
    const targets = new Map([["card:alpha", "Card: Probe Alpha"]]);
    const [known, unknown] = toFindings(
      null,
      [
        { area: "consistency", severity: "major", target: "card:alpha", detail: "Alpha killed Beta but says otherwise", fix: "x" },
        { area: "mystery", severity: "minor", target: "card:nobody", detail: "y", fix: "z" },
      ],
      targets,
    );
    expect(known).toMatchObject({ target: "card:alpha", where: "Card: Probe Alpha", summary: "Card: Probe Alpha: possible contradiction with established facts." });
    expect(unknown).toMatchObject({ target: null, where: "Package", fix: null });
  });

  it("treat spoilers in lorebook names as minor, and in visible parts as reported", () => {
    const targets = new Map([
      ["lorebook:plot", "Lorebook: Plot"],
      ["opening", "Opening scene and teaser"],
    ]);
    const [lore, opening] = toFindings(
      "spoilers",
      [
        { severity: "major", target: "lorebook:plot", detail: "x", fix: "y" },
        { severity: "major", target: "opening", detail: "x", fix: "y" },
      ],
      targets,
    );
    expect(lore!.severity).toBe("minor");
    expect(opening!.severity).toBe("major");
  });

  it("require clue entries keyed on their place, one place per entry", () => {
    const plan = planSchema.parse(fixture.plan);
    const clues = {
      conclusions: [{ id: "c1", statement: "x", factIds: [] }],
      clues: [
        { id: "k1", conclusionId: "c1", where: "harbor", how: "a", factId: "f1" },
        { id: "k2", conclusionId: "c1", where: "office", how: "b", factId: "f2" },
      ],
      redHerrings: [],
    };
    const entry = (key: string, keys: string[], factIds: string[]) =>
      lorebookOutputSchema.parse({ entries: [{ key, name: key, content: "x", keys, factIds }] }).entries[0]!;
    const mixed = checkClueEntries({ entries: [entry("clues", ["Probe Harbor"], ["f1", "f2"])] }, clues, plan).join(" | ");
    expect(mixed).toMatch(/mixes clues from 2 places/);
    expect(mixed).toMatch(/no key for Probe Office/);
    const good = checkClueEntries(
      { entries: [entry("harbor-clues", ["Probe Harbor"], ["f1"]), entry("office-clues", ["Probe Office"], ["f2"])] },
      clues,
      plan,
    );
    expect(good).toEqual([]);
  });
});

// ── Audit inside the pipeline ──

const PORT = 7880;
const host = `127.0.0.1:${PORT}`;
const write = { host, "x-adv-csrf": "1", "content-type": "application/json" };
let app: FastifyInstance;
let db: Db;

const requirements = requirementsSchema.parse({
  idea: "Neutral probe pitch.",
  genre: "noir detective mystery",
  tone: ["neutral"],
  setting: { era: "probe era", place: "probe city" },
  startingSituation: "A probe begins.",
  maxNpcCards: 3,
});

const stageOf = (req: RecordedRequest) => {
  const system = (req.body as { messages: Array<{ content: string }> }).messages[0]!.content;
  const stage = system.match(/^Stage: ([\w-]+)/m)?.[1] ?? "?";
  const sub = system.match(/^Card key: (\S+)/m)?.[1] ?? system.match(/^Lorebook: (\w+)/m)?.[1] ?? null;
  return { stage, sub, system };
};

type Questions = Record<string, { type: string; instructions: string; criteria?: string[] }>;
/** Answers per judged part; `version` counts Beta card rewrites when varyBeta is on. */
type DecideFn = (part: string, version: number, questions: Questions) => Record<string, unknown>;

const judgedPart = (state: Record<string, any>) =>
  state.characterCard ? `card:${state.characterCard.key}` : state.playerPersona ? "persona" : state.lorebook ? `lorebook:${state.lorebook.name}` : "opening";

/** Every requirement holds at p, quality at level q of 4. */
const answers = (questions: Questions, p: number, q = 3.6) =>
  Object.fromEntries(
    Object.entries(questions).map(([k, v]) => [k, v.type === "score" ? { type: "score", score: q, probabilities: {}, confidence: 0.9 } : { type: "noul", noul: p }]),
  );

async function setup(options: { review?: () => unknown; embeddings?: boolean; decide?: DecideFn; varyBeta?: boolean } = {}) {
  let betaCalls = 0;
  const fake = fakeFetch({
    "POST /decisions": (req) => {
      const body = req.body as { state: Record<string, any>; questions: Questions };
      const part = judgedPart(body.state);
      const version = Number(/ v(\d+)$/.exec(body.state.characterCard?.description ?? "")?.[1] ?? 0);
      return { json: { answers: options.decide!(part, version, body.questions) } };
    },
    "GET /models": () => ({ json: { data: [{ id: "m1" }, { id: "e1" }] } }),
    "POST /embeddings": (req) => {
      const input = (req.body as { input: string[] }).input;
      return { json: { data: input.map((_, i) => ({ index: i, embedding: [1, i % 3, (i * 7) % 5] })) } };
    },
    "POST /chat/completions": (req) => {
      const { stage, sub } = stageOf(req);
      const f = fixture as Record<string, any>;
      const body =
        stage === "audit-review" && options.review
          ? options.review()
          : stage === "card" && sub === "beta" && options.varyBeta
            ? { ...f.cards.beta, description: `${f.cards.beta.description} v${betaCalls++}` }
            : stage === "card"
            ? f.cards[sub!]
            : stage === "lorebook"
              ? f.lorebooks[sub!]
              : f[stage];
      return { json: { choices: [{ message: { content: JSON.stringify(body) } }] } };
    },
  });
  db = openDatabase(":memory:");
  app = await buildApp({ db, secretStore: new MemorySecretStore(), dataDir: "x", port: PORT, fetch: fake.fetch });
  const conn = (await app.inject({ method: "POST", url: "/api/connections", headers: write, payload: { kind: "nano-gpt", name: "N", apiKey: "k" } })).json();
  await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "text" } });
  await app.inject({ method: "PUT", url: "/api/assignments/text", headers: write, payload: { connectionId: conn.id, modelId: "m1" } });
  if (options.embeddings) {
    await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models`, headers: write, payload: { capability: "embedding", modelId: "e1" } });
    await app.inject({ method: "PUT", url: "/api/assignments/embedding", headers: write, payload: { connectionId: conn.id, modelId: "e1" } });
  }
  if (options.decide) {
    await app.inject({ method: "POST", url: `/api/connections/${conn.id}/models/fetch`, headers: write, payload: { capability: "decision" } });
    await app.inject({ method: "PUT", url: "/api/assignments/decision", headers: write, payload: { connectionId: conn.id, modelId: "typesafe/jev-1.14" } });
  }
  const id = (await app.inject({ method: "POST", url: "/api/projects", headers: write, payload: { title: "Probe Case" } })).json().id as string;
  await app.inject({ method: "PUT", url: `/api/projects/${id}/requirements`, headers: write, payload: { requirements } });
  await app.inject({ method: "POST", url: `/api/projects/${id}/requirements/approve`, headers: write, payload: {} });
  return { id, requests: fake.requests };
}

async function run(id: string): Promise<GenerationState> {
  await app.inject({ method: "POST", url: `/api/projects/${id}/generation/start`, headers: write, payload: { confirmUsage: true } });
  await (app as unknown as { pipeline: Pipeline }).pipeline.idle(id);
  return (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json();
}

afterEach(async () => {
  await app?.close();
  db?.close();
});

describe("audit stage", () => {
  it("reports a clean package with its scope and limits", async () => {
    const { id } = await setup();
    const state = await run(id);
    expect(state.ready).toBe(true);
    expect(state.audit).toMatchObject({ findings: [], fixRounds: 0, maxFixRounds: 2 });
    expect(state.audit!.notChecked.join(" ")).toMatch(/no embedding model assigned/);
    const zip = readZip((await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } })).rawPayload);
    expect(zip.get("probe-case/qa-report.md")!.toString()).toMatch(/no open findings/);
  });

  it("sends a major finding back to its stage, with a round limit, and hides details", async () => {
    const finding = { area: "consistency", severity: "major", target: "card:beta", detail: "HIDDEN_DETAIL", fix: "FIX_BETA_TIMELINE" };
    const { id, requests } = await setup({ review: () => ({ findings: [finding] }) });
    const state = await run(id);
    expect(state.ready).toBe(true);
    // The model keeps reporting it, so the loop stops at the limit (2 rounds) and leaves it open.
    expect(state.audit!.fixRounds).toBe(2);
    expect(state.audit!.findings).toHaveLength(1);
    expect(state.audit!.findings[0]).toMatchObject({ where: "Card: Probe Beta", severity: "major", source: "model" });
    expect(JSON.stringify(state)).not.toContain("HIDDEN_DETAIL");

    const chats = requests.filter((r) => r.url.includes("chat/completions"));
    const betaPrompts = chats.filter((r) => stageOf(r).stage === "card" && stageOf(r).sub === "beta").map((r) => stageOf(r).system);
    expect(betaPrompts).toHaveLength(3);
    expect(betaPrompts[0]).not.toContain("REVISION");
    // Fixes edit the previous output instead of starting over.
    expect(betaPrompts[1]).toContain("REVISION of your previous output");
    expect(betaPrompts[1]).toContain("PREVIOUS OUTPUT");
    expect(betaPrompts[1]).toContain("CARD_BETA_DESCRIPTION");
    expect(betaPrompts[1]).toContain("FIX_BETA_TIMELINE");
    expect(betaPrompts[2]).toContain("Already fixed in earlier revisions");
    // Other cards were not regenerated.
    expect(chats.filter((r) => stageOf(r).sub === "alpha")).toHaveLength(1);

    const zip = readZip((await app.inject({ method: "GET", url: `/api/projects/${id}/export`, headers: { host } })).rawPayload);
    const report = zip.get("probe-case/qa-report.md")!.toString();
    expect(report).toMatch(/1 open findings \(1 major\)/);
    expect(report).toContain("Card: Probe Beta");
    expect(report).not.toContain("HIDDEN_DETAIL");

    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { showSpoilers: true } });
    const revealed = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    expect(revealed.audit!.findings[0]!.detail).toBe("HIDDEN_DETAIL");
  });

  it("opens a new fix session on request without regenerating what was fixed", async () => {
    const finding = { area: "consistency", severity: "major", target: "card:beta", detail: "d", fix: "FIX" };
    const { id, requests } = await setup({ review: () => ({ findings: [finding] }) });
    await run(id);
    const chats = () => requests.filter((r) => r.url.includes("chat/completions"));
    const before = chats().length;
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/generation/audit/rerun`, headers: write, payload: { confirmUsage: true } });
    expect(res.statusCode).toBe(200);
    await (app as unknown as { pipeline: Pipeline }).pipeline.idle(id);
    const state = (await app.inject({ method: "GET", url: `/api/projects/${id}/generation`, headers: { host } })).json() as GenerationState;
    // A fresh audit, then two fix rounds on Beta only. The mock returns an identical card, so the
    // package does not change and the audit is not repeated after each fix (a real model's would be).
    const again = chats().slice(before).map((r) => stageOf(r).stage);
    expect(again).toEqual(["audit-review", "audit-spoilers", "card", "card"]);
    expect(state.audit!.fixRounds).toBe(2);
    expect(state.audit!.findings[0]!.fix).toBe("auto");
  });

  it("leaves plan-level findings to the player and never auto-fixes them", async () => {
    const finding = { area: "mystery", severity: "major", target: "package", detail: "hole", fix: "rethink" };
    const { id, requests } = await setup({ review: () => ({ findings: [finding] }) });
    const state = await run(id);
    expect(state.audit!.fixRounds).toBe(0);
    expect(state.audit!.findings[0]).toMatchObject({ where: "Package", fix: "plan", severity: "major" });
    expect(requests.filter((r) => r.url.includes("chat/completions") && stageOf(r).stage === "audit-review")).toHaveLength(1);
  });

  it("uses embeddings for duplicate candidates when an embedding model is assigned", async () => {
    const { id, requests } = await setup({ embeddings: true });
    const state = await run(id);
    expect(requests.some((r) => r.url.includes("/embeddings"))).toBe(true);
    expect(state.audit!.checked.join(" ")).toMatch(/Paraphrased duplicates by embeddings \(N · e1\)/);
  });
});

describe("decision-model judge", () => {
  const decisions = (requests: RecordedRequest[]) => requests.filter((r) => r.url.endsWith("/decisions"));
  const betaPrompts = (requests: RecordedRequest[]) =>
    requests.filter((r) => r.url.includes("chat/completions") && stageOf(r).stage === "card" && stageOf(r).sub === "beta").map((r) => stageOf(r).system);

  it("scores every part against the requirements and reports numbers only", async () => {
    const { id, requests } = await setup({ decide: (_part, _v, q) => answers(q, 0.92) });
    const state = await run(id);
    const judge = state.audit!.judge!;
    expect(judge).toMatchObject({ model: "N · typesafe/jev-1.14", threshold: 0.7, maxRounds: 4 });
    expect(judge.parts.map((p) => p.where)).toEqual(expect.arrayContaining(["Card: Probe Alpha", "Card: Probe Beta", "Persona", "Opening scene and teaser"]));
    expect(judge.parts.every((p) => p.pass && Math.abs(p.quality - 0.9) < 1e-9)).toBe(true);
    expect(judge.rounds).toEqual([{ round: 0, passed: judge.parts.length, total: judge.parts.length, lowest: 0.9, mean: expect.closeTo(0.9, 9) }]);
    expect(state.audit!.findings).toEqual([]);
    expect(state.audit!.checked.join(" ")).toMatch(/decision model: N · typesafe\/jev-1.14/);

    const calls = decisions(requests);
    expect(calls).toHaveLength(judge.parts.length);
    const card = calls.find((r) => judgedPart((r.body as any).state) === "card:beta")!.body as { model: string; questions: Questions };
    expect(card.model).toBe("typesafe/jev-1.14");
    expect(Object.keys(card.questions)).toEqual(["genre", "tone", "setting", "content", "quality"]);
    expect(card.questions.genre!.instructions).toContain("noir detective mystery");
    expect(card.questions.quality!.criteria).toHaveLength(5);
    const opening = calls.find((r) => judgedPart((r.body as any).state) === "opening")!.body as { questions: Questions };
    expect(Object.keys(opening.questions)).toEqual(expect.arrayContaining(["narration", "start"]));
    // The report carries scores and labels, never the judged text.
    expect(JSON.stringify(judge)).not.toContain("CARD_BETA_DESCRIPTION");
  });

  it("rewrites a failing part beyond the fix limit while it improves, up to the judge's rounds", async () => {
    const { id, requests } = await setup({
      varyBeta: true,
      decide: (part, v, q) => ({ ...answers(q, 0.9), ...(part === "card:beta" ? { genre: { type: "noul", noul: 0.17 * v } } : {}) }),
    });
    const state = await run(id);
    const beta = state.audit!.judge!.parts.find((p) => p.where === "Card: Probe Beta")!;
    expect(state.audit!.fixRounds).toBe(4);
    expect(state.audit!.judge!.rounds.map((r) => r.round)).toEqual([0, 1, 2, 3, 4]);
    expect(beta).toMatchObject({ pass: false, restored: false });
    expect(beta.score).toBeCloseTo(0.68);
    expect(state.audit!.findings).toEqual([expect.objectContaining({ area: "fit", where: "Card: Probe Beta", fix: "auto" })]);
    const prompts = betaPrompts(requests);
    expect(prompts).toHaveLength(5);
    expect(prompts[1]).toContain("Genre: the answer to");
    expect(prompts[1]).toContain("Keep every fact, name, clue, secret and relationship unchanged");
  });

  it("stops early when a round brings no improvement", async () => {
    const { id, requests } = await setup({
      varyBeta: true,
      decide: (part, _v, q) => answers(q, part === "card:beta" ? 0.3 : 0.9),
    });
    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { maxAutoFixAttempts: 0 } });
    const state = await run(id);
    expect(state.audit!.fixRounds).toBe(1);
    expect(state.audit!.judge!.rounds.map((r) => r.passed)).toEqual([6, 6]);
    expect(betaPrompts(requests)).toHaveLength(2);
  });

  it("keeps the better-scored earlier version when a rewrite scores worse", async () => {
    const { id } = await setup({
      varyBeta: true,
      decide: (part, v, q) => answers(q, part === "card:beta" ? (v === 0 ? 0.65 : 0.2) : 0.9),
    });
    await app.inject({ method: "PATCH", url: "/api/settings", headers: write, payload: { maxAutoFixAttempts: 0 } });
    const state = await run(id);
    const beta = state.audit!.judge!.parts.find((p) => p.where === "Card: Probe Beta")!;
    expect(state.ready).toBe(true);
    expect(beta).toMatchObject({ restored: true, pass: false });
    expect(beta.score).toBeCloseTo(0.65);
    const pkg = (app as unknown as { pipeline: Pipeline }).pipeline.assembled(id)!.package;
    expect(pkg.characters.find((c) => c.key === "beta")!.description).toMatch(/ v0$/);
  });

  it("reports the judge as not run when the decision request fails", async () => {
    const { id } = await setup({
      decide: () => {
        throw new Error("boom");
      },
    });
    const state = await run(id);
    expect(state.ready).toBe(true);
    expect(state.audit!.judge).toBeNull();
    expect(state.audit!.notChecked.join(" ")).toMatch(/Fit and quality by a decision model/);
  });
});
