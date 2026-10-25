// Builds pipeline-fixture.json: a neutral probe adventure (markers and filler, no story) sized to
// pass the stage checks for a "medium" adventure. Run: node tools/marinara-test/build-pipeline-fixture.mjs
import { writeFileSync } from "node:fs";

const filler = (marker, words = 60) => `${marker} ${Array.from({ length: words }, (_, i) => `probe${i % 7}`).join(" ")}.`;

const entities = [
  ["alpha", "character", "Probe Alpha", true],
  ["beta", "character", "Probe Beta", true],
  ["gamma", "character", "Probe Gamma", false],
  ["delta", "character", "Probe Delta", false],
  ["epsilon", "character", "Probe Epsilon", false],
  ["harbor", "location", "Probe Harbor", false],
  ["office", "location", "Probe Office", false],
  ["warehouse", "location", "Probe Warehouse", false],
  ["tavern", "location", "Probe Tavern", false],
  ["ledger", "item", "Probe Ledger", false],
  ["lantern", "item", "Probe Lantern", false],
  ["guild", "organization", "Probe Guild", false],
  ["wards", "concept", "Probe Wards", false],
  ["tides", "concept", "Probe Tides", false],
].map(([key, type, name, isCard]) => ({
  key,
  type,
  name,
  aliases: [],
  publicDescription: `A probe ${type}.`,
  role: `PLAN_ROLE_${key.toUpperCase()}`,
  isCard,
}));

const plan = {
  premise: "PLAN_PREMISE (neutral probe, no real story)",
  isMystery: true,
  truth: {
    summary: "PLAN_TRUTH_SUMMARY",
    timeline: [
      { when: "Day 1", what: "PLAN_TIMELINE_1" },
      { when: "Day 2", what: "PLAN_TIMELINE_2" },
    ],
    culprit: "gamma",
    motive: "PLAN_MOTIVE",
    method: "PLAN_METHOD",
  },
  entities,
  threads: [{ key: "ledger-thread", name: "Ledger", description: "PLAN_THREAD" }],
  openingCardKey: "alpha",
};

// Facts: homes by entity type; cards get a few card-homed facts and three perspectives each.
const facts = [];
const add = (subject, layer, secrecy, home, extra = {}) =>
  facts.push({
    id: `f${facts.length + 1}`,
    subject,
    statement: `FACT_${subject.toUpperCase()}_${facts.length + 1}`,
    layer,
    holder: null,
    contradicts: null,
    secrecy,
    home,
    ...extra,
  });
const lore = (lorebook) => ({ kind: "lorebook", lorebook });
const card = (c, field) => ({ kind: "card", card: c, field });

for (const [c, fields] of [
  ["alpha", ["description", "personality", "appearance", "scenario"]],
  ["beta", ["description", "backstory", "appearance", "scenario"]],
]) {
  for (const field of fields) add(c, "truth", "public", card(c, field));
}
const homeFor = { location: "world", organization: "world", concept: "world", item: "plot", character: "characters" };
for (const e of entities.filter((x) => !x.isCard)) {
  for (let i = 0; i < 5; i++) add(e.key, i < 3 ? "public" : "truth", i < 3 ? "public" : "hidden", lore(homeFor[e.type]));
}
for (let i = 0; i < 6; i++) add("ledger", "truth", "secret", lore("plot"));
const firstTruth = facts.find((f) => f.subject === "ledger" && f.secrecy === "secret").id;
for (const holder of ["alpha", "beta"]) {
  for (let i = 0; i < 3; i++) {
    add("ledger", i === 0 ? "claim" : "belief", "hidden", lore("plot"), { holder, contradicts: i === 0 ? firstTruth : null });
  }
}
while (facts.length < 80) add("tides", "public", "public", lore("world"));

// Lorebooks: one entry per subject (facts grouped), private entries for card perspectives.
const lorebooks = { world: { entries: [] }, characters: { entries: [] }, plot: { entries: [] } };
const bySubjectHome = new Map();
for (const f of facts.filter((x) => x.home.kind === "lorebook")) {
  const privateTo = f.holder && ["alpha", "beta"].includes(f.holder) ? f.holder : "";
  const k = `${f.home.lorebook}|${f.subject}|${privateTo}`;
  bySubjectHome.set(k, [...(bySubjectHome.get(k) ?? []), f]);
}
for (const [k, group] of bySubjectHome) {
  const [lb, subject, privateTo] = k.split("|");
  const entity = entities.find((e) => e.key === subject);
  const entryKey = `${subject}${privateTo ? `-${privateTo}` : ""}`;
  lorebooks[lb].entries.push({
    key: entryKey,
    name: `${entity.name}${privateTo ? ` (${privateTo})` : ""}`,
    content: filler(subject === "ledger" && !privateTo ? "LORE_LEDGER_SECRET" : `LORE_${entryKey.toUpperCase()}`),
    keys: [entity.name, `the ${subject}`],
    ...(privateTo ? { privateTo: [privateTo] } : {}),
    factIds: group.map((f) => f.id),
  });
}
lorebooks.world.entries.unshift({ key: "premise", name: "Premise", content: "LORE_PREMISE", type: "constant", order: 10, factIds: [] });
lorebooks.plot.entries[0].sticky = 3;

const clues = {
  conclusions: [{ id: "c1", statement: "CLUE_CONCLUSION", factIds: [firstTruth] }],
  clues: [
    { id: "k1", conclusionId: "c1", where: "harbor", how: "CLUE_HARBOR", factId: null },
    { id: "k2", conclusionId: "c1", where: "office", how: "CLUE_OFFICE", factId: null },
    { id: "k3", conclusionId: "c1", where: "gamma", how: "CLUE_GAMMA", factId: null },
  ],
  redHerrings: [{ id: "h1", statement: "CLUE_HERRING", explanation: "CLUE_HERRING_EXPLANATION" }],
};

const cardOut = (key, name, firstMessage) => ({
  name,
  tags: ["probe"],
  description: `CARD_${key.toUpperCase()}_DESCRIPTION`,
  personality: `CARD_${key.toUpperCase()}_PERSONALITY`,
  backstory: `CARD_${key.toUpperCase()}_BACKSTORY`,
  appearance: `CARD_${key.toUpperCase()}_APPEARANCE`,
  ...(key === "alpha" ? { imageAppearance: "probe, portrait" } : {}),
  scenario: `CARD_${key.toUpperCase()}_SCENARIO`,
  firstMessage,
  exampleDialogue: `<START>\n{{user}}: Hello.\n{{char}}: CARD_${key.toUpperCase()}_EXAMPLE`,
});

const fixture = {
  plan,
  facts: { facts },
  clues,
  cards: { alpha: cardOut("alpha", "Probe Alpha", ""), beta: cardOut("beta", "Probe Beta", "CARD_BETA_FIRST_MESSAGE") },
  persona: {
    name: "Probe Investigator",
    tags: ["probe"],
    description: "PERSONA_DESCRIPTION",
    personality: "PERSONA_PERSONALITY",
    backstory: "PERSONA_BACKSTORY",
    appearance: "PERSONA_APPEARANCE",
    scenario: "PERSONA_SCENARIO",
    exampleDialogue: "",
  },
  lorebooks,
  opening: {
    teaser: "A neutral probe adventure at a probe harbor.",
    openingMessage: "OPENING_MESSAGE_ALPHA",
    secretPlot: {
      description: "SECRET_PLOT_ARC",
      protagonistArc: "SECRET_PLOT_PROTAGONIST",
      characterArc: "SECRET_PLOT_CHARACTER",
      sceneDirections: ["SECRET_BEAT_1", "SECRET_BEAT_2", "SECRET_BEAT_3"],
      pacing: "steady",
    },
  },
};

writeFileSync(new URL("./pipeline-fixture.json", import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`facts ${facts.length}, entities ${entities.length}, entries ${Object.values(lorebooks).map((l) => l.entries.length).join("/")}`);
