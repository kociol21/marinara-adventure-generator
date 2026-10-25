// Import probe: pushes neutral fixture files through Marinara's native import route
// and reads back what was actually stored. Usage: node import-probe.mjs [baseUrl]
const base = process.argv[2] ?? "http://127.0.0.1:7870";
const headers = { "Content-Type": "application/json", "x-marinara-csrf": "1" };

async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const envelope = (type, data) => ({ type, version: 1, exportedAt: new Date().toISOString(), data });

const card = (name, tag) =>
  envelope("marinara_character", {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: `${name} DESCRIPTION_FIELD`,
      personality: `${name} PERSONALITY_FIELD`,
      scenario: `${name} SCENARIO_FIELD`,
      first_mes: `${name} FIRST_MES_FIELD`,
      mes_example: `<START>\n{{user}}: Hi.\n{{char}}: ${name} EXAMPLE_FIELD`,
      tags: [tag, "probe"],
      extensions: { backstory: `${name} BACKSTORY_FIELD`, appearance: `${name} APPEARANCE_FIELD` },
    },
    metadata: { comment: "probe" },
  });

const report = {};

const alpha = await api("POST", "/api/import/marinara", card("Probe Alpha", "adv-probe-alpha"));
const beta = await api("POST", "/api/import/marinara", card("Probe Beta", "adv-probe-beta"));
report.characters = [alpha, beta];

report.persona = await api(
  "POST",
  "/api/import/marinara",
  envelope("marinara_persona", {
    name: "Probe Persona",
    description: "PERSONA_DESCRIPTION",
    personality: "PERSONA_PERSONALITY",
    backstory: "PERSONA_BACKSTORY",
    appearance: "PERSONA_APPEARANCE",
    scenario: "PERSONA_SCENARIO",
    tags: ["probe"],
  }),
);

const lb = await api(
  "POST",
  "/api/import/marinara",
  envelope("marinara_lorebook", {
    lorebook: {
      name: "Probe Plot",
      description: "probe",
      category: "world",
      tokenBudget: 3000,
      scanDepth: 4,
      excludeFromVectorization: false,
      vectorScoreThreshold: 0.4,
      vectorMaxResults: 5,
      characterIds: ["id-from-another-install"],
      tags: ["probe"],
    },
    entries: [
      { name: "Premise", content: "PROBE_PREMISE", constant: true, order: 10 },
      {
        name: "Alpha private",
        content: "ALPHA_PRIVATE",
        keys: ["lighthouse"],
        matchWholeWords: true,
        characterTagFilterMode: "include",
        characterTagFilters: ["adv-probe-alpha"],
        characterFilterMode: "include",
        characterFilterIds: ["id-from-another-install"],
        sticky: 2,
        excludeFromVectorization: true,
      },
      {
        name: "Selective",
        content: "SELECTIVE_ENTRY",
        keys: ["king"],
        secondaryKeys: ["harbor"],
        selective: true,
        selectiveLogic: "and_any",
        delay: 3,
        group: "g1",
        decisionMode: "require",
        decisionStatement: "A king is physically present in the latest message",
      },
    ],
  }),
);
report.lorebookImport = lb;

const lbId = lb.id;
report.lorebook = await api("GET", `/api/lorebooks/${lbId}`);
report.entries = await api("GET", `/api/lorebooks/${lbId}/entries`);
report.alphaStored = await api("GET", `/api/characters/${alpha.id}`);

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const lbStored = report.lorebook;
console.log("characters:", report.characters);
console.log("persona:", report.persona);
console.log(
  "lorebook:",
  pick(lbStored, ["name", "category", "tokenBudget", "scanDepth", "characterIds", "characterId", "vectorScoreThreshold", "vectorMaxResults", "isGlobal", "tags"]),
);
for (const e of Array.isArray(report.entries) ? report.entries : report.entries.entries ?? []) {
  console.log(
    "entry:",
    pick(e, ["name", "constant", "selective", "selectiveLogic", "characterTagFilterMode", "characterTagFilters", "characterFilterIds", "sticky", "delay", "group", "excludeFromVectorization", "decisionMode", "decisionStatement", "matchWholeWords"]),
  );
}
const alphaData = report.alphaStored?.data ?? report.alphaStored;
console.log("alpha stored keys:", Object.keys(alphaData ?? {}));
console.log("alpha stored:", JSON.stringify(alphaData).slice(0, 900));
