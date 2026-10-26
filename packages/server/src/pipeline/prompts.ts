import { hasProseStyle, type Requirements } from "@adv/shared";
import type { Clues, Entity, Fact, Facts, LorebookKey, Plan } from "./schemas.ts";
import { scaleTargets } from "./scale.ts";

/**
 * Stage prompts. Every prompt starts with "Stage: <id>" so logs and the mock model can tell
 * stages apart. All content is English (spec §22). Bump PROMPT_VERSION when a prompt changes
 * meaningfully: it is part of each stage's input hash, so affected stages re-run.
 */
export const PROMPT_VERSION = "3";

const JSON_ONLY = "Reply with ONLY one JSON object matching the shape below. No prose, no code fences.";

export function brief(r: Requirements): string {
  const c = r.content;
  return `ADVENTURE REQUIREMENTS (approved by the player)
Genre: ${[r.genre, ...r.subgenres].filter(Boolean).join(", ")}
Tone: ${r.tone.join(", ")}
Narration: ${r.narration.pov} person, ${r.narration.tense} tense.
Prose voice: ${r.narration.style || "fitting the genre"}${r.narration.inspirations.length ? ` (in the manner of ${r.narration.inspirations.join(", ")})` : ""}; intensity ${r.narration.intensity}.
Setting: ${r.setting.era}; ${r.setting.place}. Technology: ${r.setting.technology || "fitting the era"}. Supernatural: ${r.setting.supernatural || "none"}. ${r.setting.notes}
Starting situation: ${r.startingSituation}
Protagonist (the player): ${r.protagonist.notes || "unspecified"}; ${r.protagonist.mode === "new" ? "a new persona will be written" : "the player brings an existing persona, so never fix their name, look or history"}.
Full NPC character cards: at most ${r.maxNpcCards}. Any number of minor characters may exist in lorebooks if they serve the story.
Length: ${r.scale.length}. ${r.scale.notes}
Content limits: violence ${c.violence}, romance ${c.romance}, sexual content ${c.sexualContent}, horror ${c.horror}.${c.hardLimits.length ? ` Never include: ${c.hardLimits.join("; ")}.` : ""} ${c.notes}
${r.mustInclude.length ? `The player asked for: ${r.mustInclude.join("; ")}.` : ""}
Original pitch: ${r.idea}`;
}

/**
 * The narrator in Marinara imitates the voice of what it reads, most of all greetings, example
 * dialogue and the opening. So the voice is applied in layers: full in play text, lighter in
 * descriptive material it must still read as information, and not at all in internal planning.
 */
export function voiceRule(r: Requirements, level: "internal" | "descriptive" | "play"): string {
  if (level === "internal") return "Write plainly and precisely; the prose voice is applied in later stages.";
  if (!hasProseStyle(r)) return level === "play" ? "Write vivid prose fitting the genre and tone." : "Write clear prose with a touch of the genre's flavour.";
  const voice = `${r.narration.style}${r.narration.inspirations.length ? ` Echo the style of ${r.narration.inspirations.join(", ")}: rhythm, diction, imagery and attitude. Never quote them or reuse their lines, characters or plots.` : ""}`;
  if (level === "play") return `Write fully in the adventure's prose voice: ${voice} The narrator will imitate this text, so it sets the voice of the whole game.`;
  return r.narration.intensity === "strong"
    ? `Write in the adventure's prose voice: ${voice} Keep every sentence informative: the narrator reads this as reference.`
    : `Give the text a light touch of the adventure's prose voice (${voice}) while keeping it clear and informative: the narrator reads this as reference, so information comes first.`;
}

const COMMON = `You are part of a pipeline that writes a complete adventure for the Marinara Engine roleplay app. The player will discover the story while playing, so this material is hidden from them; it must still be consistent, fair and playable.
All output is English. Stay inside the content limits. Do not decide the protagonist's actions, words or feelings.`;

export function planPrompt(r: Requirements): string {
  const t = scaleTargets(r);
  return `Stage: plan
${COMMON}

Design the adventure's foundation: the objective truth, the cast and the world's important things.
Size for a ${r.scale.length} adventure: at least ${t.entities} entities, including at least ${t.locations} locations the player can visit, at least ${t.minorCharacters} minor characters without cards (witnesses, rivals, fixers, officials), at least one organization and the items that matter. A living world has more people and places than the card cast; every one of them still needs a function.
- Build a situation with motives and conflicts that reacts to the player, not a fixed sequence of scenes.
- ${r.genre.toLowerCase().includes("myster") || r.genre.toLowerCase().includes("detective") || r.genre.toLowerCase().includes("noir") ? "This is a mystery: fix the truth now (culprit, motive, method, timeline). It must not change later." : "If the premise involves a mystery, fix its truth now; otherwise set isMystery to false."}
- Supernatural rules that the solution depends on must be part of the world from the start, not invented for the finale.
- Cast: mark at most ${r.maxNpcCards} characters with isCard=true; fewer is fine. Every character needs a function in the story. The protagonist is NOT an entity here.
- One card character opens the adventure with the starting situation; give its key as openingCardKey.
- publicDescription must contain only what anyone could know; hidden things go into role, truth and threads.
- Names must not hint at secrets.
- ${voiceRule(r, "internal")}

${brief(r)}

${JSON_ONLY}
{"premise": "...", "isMystery": true, "truth": {"summary": "...", "timeline": [{"when": "...", "what": "..."}], "culprit": "entity-key or null", "motive": "...", "method": "..."}, "entities": [{"key": "kebab-case", "type": "character|location|organization|item|concept", "name": "...", "aliases": ["..."], "publicDescription": "...", "role": "...", "isCard": false}], "threads": [{"key": "...", "name": "...", "description": "..."}], "openingCardKey": "..."}`;
}

export function factsPrompt(r: Requirements, plan: Plan): string {
  const cards = plan.entities.filter((e) => e.isCard).map((e) => e.key);
  return `Stage: facts
${COMMON}

Break the adventure into a fact registry. Each fact is one atomic statement with exactly ONE home where it is stored.
Layers (keep them apart):
- truth: what really is or happened.
- belief: what one character believes (holder required); may be wrong (then set contradicts to the true fact's id).
- claim: what one character says, including lies (holder required; set contradicts when it is false).
- public: common knowledge in the world.
Secrecy: public (anyone may know), hidden (not volunteered, findable), secret (actively concealed).
Homes:
- {"kind":"card","card":"<card key>","field":"description|personality|backstory|appearance|scenario"} for core identity of card characters (${cards.join(", ")}). Field rules: description = identity and role; personality = motives, values, contradictions, temperament, reactions under pressure; backstory = past, origins, relationships, distinguishing facts from beliefs; appearance = looks and clothing; scenario = the character's starting context only.
- {"kind":"lorebook","lorebook":"world"} for setting rules, places, organizations, history, magic, customs.
- {"kind":"lorebook","lorebook":"characters"} for minor characters and extra knowledge about card characters that needs its own trigger.
- {"kind":"lorebook","lorebook":"plot"} for the truth of the case, timeline, clues, secrets and what unlocks them.
Coverage (this registry is the narrator's only source; what is missing here does not exist in play):
- every location: what it looks, sounds and smells like, who is usually there, what happens there, what can be found or learned there;
- every character: goals, relationships, what they know, what they hide, how they behave with strangers;
- every organization and item: what it is, who controls it, why it matters;
- the world: how the supernatural works day to day, institutions, customs, prejudices, prices and dangers that colour scenes;
- the truth: the full timeline, the method, the motive, and what physical and testimonial traces each event left.
Perspectives: give every card character at least ${scaleTargets(r).perspectivesPerCard} beliefs or claims of their own (alibis, half-truths, lies, wrong guesses about others), linked with contradicts when they are false. Minor characters should have them too where they matter. Mysteries live on what people say versus what is true.
Rules: no duplicates (the same fact in other words is a duplicate); prefer lorebooks for secrets a card character holds, so they can be private to that character; write ${scaleTargets(r).facts[0]}-${scaleTargets(r).facts[1]} facts, each a concrete, specific sentence. Ids are f1, f2, … in order. ${voiceRule(r, "internal")}

${brief(r)}

PLAN
${JSON.stringify(plan)}

${JSON_ONLY}
{"facts": [{"id": "f1", "subject": "entity-key", "statement": "...", "layer": "truth|belief|claim|public", "holder": "entity-key or null", "contradicts": "fact id or null", "secrecy": "public|hidden|secret", "home": {"kind": "lorebook", "lorebook": "plot"}}]}`;
}

export function cluesPrompt(r: Requirements, plan: Plan, facts: Facts): string {
  return `Stage: clues
${COMMON}

Make the mystery solvable along several paths.
- List the conclusions the player must reach to solve it (who, how, why, and any key hidden link).
- Give EVERY conclusion at least three clues in different places or people, so missing one never blocks progress.
- Each clue says where it is (an entity key) and how it can be found; link factId when a registry fact carries it.
- Red herrings need an innocent explanation that fits the truth.
- ${voiceRule(r, "internal")}

${brief(r)}

PLAN
${JSON.stringify(plan)}

FACTS
${JSON.stringify(facts.facts)}

${JSON_ONLY}
{"conclusions": [{"id": "c1", "statement": "...", "factIds": ["f3"]}], "clues": [{"id": "k1", "conclusionId": "c1", "where": "entity-key", "how": "...", "factId": "f7 or null"}], "redHerrings": [{"id": "h1", "statement": "...", "explanation": "..."}]}`;
}

const factLines = (facts: Fact[]) => facts.map((f) => `${f.id} [${f.layer}${f.holder ? ` of ${f.holder}` : ""}, ${f.secrecy}] ${f.statement}`).join("\n");

export function cardPrompt(r: Requirements, plan: Plan, entity: Entity, own: Fact[], context: Fact[]): string {
  return `Stage: card
Card key: ${entity.key}
${COMMON}

Write the Marinara character card for ${entity.name}.
Field rules (do not copy the same biography between fields):
- description: identity, role and defining traits. No full biography.
- personality: motives, values, contradictions, temperament, reactions under pressure, behaviour patterns.
- backstory: past, origins, important relationships, causes of the present situation; separate facts from the character's beliefs and versions of events.
- appearance: looks, clothing, visual traits; concrete enough for a consistent portrait.
- scenario: short starting context and the character's place in the adventure. No summary of the whole plot.
- firstMessage: ${entity.key === plan.openingCardKey ? "leave empty; the opening stage writes it." : "a playable entrance showing the character's voice, for chats that start with this character alone. Never decide {{user}}'s actions, words or feelings."}
- exampleDialogue: 2-3 short exchanges separated by <START>, using {{user}} and {{char}}, showing voice and reactions. They are samples, not events that happened.
- tags: 2-5 neutral library tags (genre, setting); never hint at secrets.
- imageAppearance: optional short comma-separated portrait tags.
Voice of description, personality, backstory, appearance and scenario: ${voiceRule(r, "descriptive")}
Voice of firstMessage and exampleDialogue: ${voiceRule(r, "play")} In dialogue, ${entity.name} still speaks with their own idiom; the narration around it carries the prose voice.
Use the facts homed in this card. Facts homed elsewhere are context only: do not restate them; the character may allude to what they would naturally reveal.
Card fields are read by the narrator every turn, so keep secrets the character holds out of them unless the character constantly acts on them; those live in private lorebook entries.

${brief(r)}

CHARACTER
${JSON.stringify(entity)}

FACTS HOMED IN THIS CARD
${factLines(own) || "(none)"}

CONTEXT (do not restate)
${factLines(context)}

${JSON_ONLY}
{"name": "${entity.name}", "tags": ["..."], "description": "...", "personality": "...", "backstory": "...", "appearance": "...", "imageAppearance": "...", "scenario": "...", "firstMessage": "...", "exampleDialogue": "<START>\\n{{user}}: ...\\n{{char}}: ..."}`;
}

export function personaPrompt(r: Requirements, plan: Plan): string {
  return `Stage: persona
${COMMON}

Write the player's persona card (the protagonist). It is visible to the player, so it must contain no secrets of the adventure.
Give them a past and connections that make the starting situation natural, but leave their choices open. Fields: description, personality, backstory, appearance, scenario (their starting context), exampleDialogue (optional, may be empty), tags.
${voiceRule(r, "descriptive")}

${brief(r)}

PUBLIC WORLD
${plan.entities.map((e) => `${e.name}: ${e.publicDescription}`).join("\n")}

${JSON_ONLY}
{"name": "...", "tags": ["..."], "description": "...", "personality": "...", "backstory": "...", "appearance": "...", "scenario": "...", "exampleDialogue": ""}`;
}

const LOREBOOK_PURPOSE: Record<LorebookKey, string> = {
  world: "World: setting rules, places, organizations, history, magic and customs.",
  characters: "Characters: minor characters (their goals, relations, knowledge) and extra knowledge about card characters that needs its own trigger.",
  plot: "Plot: the truth of the case, timeline, clues, secrets, dependencies and what unlocks information.",
};

/** The places where each clue fact is found, in clue order (one fact may surface at several). */
export function cluePlaces(clues: Clues, plan: Plan): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>();
  for (const clue of clues.clues) {
    const place = plan.entities.find((e) => e.key === clue.where);
    if (!clue.factId || !place) continue;
    const places = out.get(clue.factId) ?? [];
    if (!places.includes(place)) places.push(place);
    out.set(clue.factId, places);
  }
  return out;
}

/** This lorebook's clue facts grouped by place; a fact found at several places goes with the first. */
export function clueGroups(clues: Clues, plan: Plan, factIds: string[]): Map<Entity, string[]> {
  const byPlace = new Map<Entity, string[]>();
  for (const [factId, places] of cluePlaces(clues, plan)) {
    if (!factIds.includes(factId)) continue;
    byPlace.set(places[0]!, [...(byPlace.get(places[0]!) ?? []), factId]);
  }
  return byPlace;
}

function clueMap(clues: Clues, plan: Plan, facts: Fact[]): string {
  return [...clueGroups(clues, plan, facts.map((f) => f.id))]
    .map(([place, ids]) => `- ${place.key} (${place.name}${place.aliases.length ? `, aka ${place.aliases.join(", ")}` : ""}): ${ids.join(", ")}`)
    .join("\n");
}

export function lorebookPrompt(r: Requirements, plan: Plan, lorebook: LorebookKey, facts: Fact[], clues: Clues | null): string {
  const cards = plan.entities.filter((e) => e.isCard);
  const map = lorebook === "plot" && clues ? clueMap(clues, plan, facts) : "";
  return `Stage: lorebook
Lorebook: ${lorebook}
${COMMON}

Write the entries of the lorebook "${LOREBOOK_PURPOSE[lorebook]}" for Marinara Engine. Render every fact below into entries; each fact goes into exactly one entry (list its ids in factIds). Group related facts about one subject into one entry.
Activation (decide for each entry: when should the narrator see this?):
- type "constant": only for a few facts true in every scene (premise, tone, core world rule). Keep constants short.
- type "normal": the default. 3-8 keys: the name plus how people actually refer to it. Avoid common words (he, city, king, door).
- type "selective": when a key is a common word or the entry should fire only with another topic; add secondaryKeys and selectiveLogic ("and_any", "and_all", "not_any", "not_all").
- matchWholeWords: true for short keys (5 letters or fewer).
- privateTo: card keys whose replies may see the entry (secrets a card character holds, their beliefs and claims). Card keys: ${cards.map((c) => `${c.key} (${c.name})`).join(", ")}.
- order: lower loads first under budget pressure; 10-50 for facts the plot hinges on, default 100.
- sticky: null by default. Use 2-4 only for the few entries that must stay in view for several turns once triggered (a scene the player is inside, a discovery being examined). At most one entry in four may be sticky; keyword matches already re-fire whenever the subject is mentioned.
- delay only for content that must not surface early.
- recursion: true only when the entry should pull in related entries it names; never on hub entries.
- description: one plain sentence summarizing the entry (used by a router agent; may be spoiler-bearing, it is hidden).
- Keys and names are visible in Marinara's editor; entry names may be plain ("Harbor office", "Alibi of …").
Content: write for the narrator who must play scenes from it. Each non-constant entry is ${scaleTargets(r).entryWords}-200 words of concrete detail: what is seen and heard, how people act, what can be learned and under which conditions, how it connects to other subjects. Plain prose, no headings. A one-line entry is too thin to play. Prefer one rich entry per subject over many fragments; split only when parts need different keys or privacy.
Voice: ${voiceRule(r, "descriptive")}${
    lorebook === "plot" && clues
      ? `\nAlso render the clue map. Clues go into entries BY PLACE: one entry per place or person where clues are found, keyed on that place's or person's name and aliases, holding only the clues found there and how they can be found. Never gather clues from different places into one entry: it would surface everything everywhere. Keep red herrings with their innocent explanation.${
          map
            ? `\nThe CLUE MAP below already groups the clue facts by place. Clue facts do not go in "entries": write them in "places", one object per line of the CLUE MAP, with "place" set to that line's entity key and "content" rendering exactly the facts on that line (what is found there, how it can be found, what it suggests). The code names the entry after the place, keys it on the place's name and aliases and attaches the fact ids; put in "keys" only extra words people use for that place. Every other fact goes in "entries".`
            : ""
        }`
      : ""
  }

${brief(r)}

ENTITIES
${plan.entities.map((e) => `${e.key}: ${e.name}${e.aliases.length ? ` (aka ${e.aliases.join(", ")})` : ""} — ${e.type}`).join("\n")}

FACTS FOR THIS LOREBOOK
${factLines(facts)}
${lorebook === "plot" && clues ? `\nCLUES\n${JSON.stringify(clues)}` : ""}${map ? `\n\nCLUE MAP (place: fact ids)\n${map}` : ""}

${JSON_ONLY}
{"entries": [{"key": "kebab-case", "name": "...", "content": "...", "description": "...", "type": "normal", "keys": ["..."], "secondaryKeys": [], "selectiveLogic": "and_any", "matchWholeWords": false, "order": 100, "sticky": null, "delay": null, "privateTo": [], "recursion": false, "factIds": ["f1"]}]${
    map ? `, "places": [{"place": "entity-key", "content": "...", "description": "...", "keys": []}]` : ""
  }}`;
}

export function openingPrompt(r: Requirements, plan: Plan, openingCard: { name: string; scenario: string; personality: string }, facts: Facts): string {
  return `Stage: opening
${COMMON}

Write three things:
1. teaser: 2-3 sentences for the player's library. Spoiler-free: only the premise the player already knows from the starting situation and the mood. No secrets, culprits, twists, hidden motives or names that hint at them.
2. openingMessage: ${openingCard.name}'s First Message that plays the starting situation ("${r.startingSituation}"). In ${r.narration.pov} person, ${r.narration.tense} tense. Show ${openingCard.name}'s voice, hand the scene to the player, and never decide {{user}}'s actions, words or feelings. No secrets stated outright.
3. secretPlot: the Narrative Director's hidden long-term arc, consistent with the truth:
   description (2-4 sentences: the arc, its mystery, resolution conditions, the protagonist's journey), protagonistArc (1-2 sentences), characterArc (1-2 sentences about ${openingCard.name}), sceneDirections (3-6 short beats the story could pass through, not fixed scenes), pacing (one phrase).
Voice of openingMessage: ${voiceRule(r, "play")}
Voice of teaser: ${voiceRule(r, "descriptive")}
secretPlot: ${voiceRule(r, "internal")}

${brief(r)}

PLAN
${JSON.stringify(plan)}

OPENING CHARACTER
${JSON.stringify(openingCard)}

TRUTH FACTS
${factLines(facts.facts.filter((f) => f.layer === "truth"))}

${JSON_ONLY}
{"teaser": "...", "openingMessage": "...", "secretPlot": {"description": "...", "protagonistArc": "...", "characterArc": "...", "sceneDirections": ["..."], "pacing": "..."}}`;
}

/** The title is player-facing, so it sees only what the player may know: requirements, teaser, public descriptions. */
export function titlePrompt(r: Requirements, plan: Plan, teaser: string, workingTitle: string, rejected: string[]): string {
  const known = plan.entities.filter((e) => e.isCard || e.type === "location" || e.type === "organization");
  return `Stage: title
You name an adventure for the Marinara Engine roleplay app. The title is the first thing the player sees: on the library card, the Marinara chat and its folders. All output is English.

Write one title:
- 1 to 6 words, evocative and memorable, like the title of a published ${[r.genre, ...r.subgenres].filter(Boolean).join(" / ") || "genre"} story.
- Match the tone (${r.tone.join(", ") || "fitting the genre"}) and the prose voice (${r.narration.style || "fitting the genre"}${r.narration.inspirations.length ? `; in the manner of ${r.narration.inspirations.join(", ")}` : ""}).
- Name the story, do not describe its genre: "Slice of Life Yuri Romance" or "A Noir Mystery in 1940s New York" are wrong.
- Spoiler-free: use only what the teaser and the public descriptions below reveal. No culprits, twists, hidden motives or secret identities.
- No quotation marks and no trailing punctuation.
- The player's working label was "${workingTitle}"; do not reuse it word for word.${rejected.length ? `\n- The player rejected these titles; write something clearly different: ${rejected.map((t) => `"${t}"`).join(", ")}.` : ""}

${brief(r)}

TEASER
${teaser}

PUBLIC CAST AND PLACES
${known.map((e) => `- ${e.name} (${e.type}): ${e.publicDescription}`).join("\n")}

${JSON_ONLY}
{"title": "..."}`;
}

/** Built by code, not the model: a short constant reminder of the voice for every reply. */
export function narrativeVoiceEntry(r: Requirements): string | null {
  if (!hasProseStyle(r)) return null;
  const parts = [
    `Narrate in ${r.narration.pov} person, ${r.narration.tense} tense.`,
    r.narration.style ? `Prose voice: ${r.narration.style}.` : "",
    r.narration.inspirations.length
      ? `Echo the style of ${r.narration.inspirations.join(", ")}: rhythm, diction, imagery and attitude. Do not quote them or borrow their characters or plots.`
      : "",
    r.tone.length ? `Tone: ${r.tone.join(", ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\.\./g, ".");
}
