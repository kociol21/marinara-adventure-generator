import { describe, expect, it } from "vitest";
import { requirementsSchema } from "@adv/shared";
import { checkFacts, checkLorebook, checkPlan, resolveFactKeys, withWholeWordsForShortKeys } from "../src/pipeline/stages.ts";
import { planSchema, factsSchema, lorebookOutputSchema } from "../src/pipeline/schemas.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const medium = requirementsSchema.parse({ maxNpcCards: 4, scale: { length: "medium" } });
const plan = planSchema.parse(fixture.plan);
const facts = factsSchema.parse(fixture.facts);
const cardKeys = new Set(["alpha", "beta"]);

describe("short keys", () => {
  const entry = (keys: string[], extra = {}) => ({ keys, secondaryKeys: [], useRegex: false, matchWholeWords: false, ...extra });

  it("get whole-word matching, other entries stay as they are", () => {
    expect(withWholeWordsForShortKeys(entry(["Rook", "Felix Rook"])).matchWholeWords).toBe(true);
    expect(withWholeWordsForShortKeys(entry(["the harbor office"], { secondaryKeys: ["dock"] })).matchWholeWords).toBe(true);
    expect(withWholeWordsForShortKeys(entry(["Brooklyn", "the harbor"])).matchWholeWords).toBe(false);
    expect(withWholeWordsForShortKeys(entry(["ab?c"], { useRegex: true })).matchWholeWords).toBe(false);
  });
});

describe("richness checks", () => {
  it("accept the medium-size fixture", () => {
    expect(checkPlan(plan, medium)).toEqual([]);
    expect(checkFacts(facts, plan, medium)).toEqual([]);
    for (const [key, lb] of Object.entries(fixture.lorebooks)) {
      const out = lorebookOutputSchema.parse(lb);
      const ids = facts.facts.filter((f) => f.home.kind === "lorebook" && f.home.lorebook === key).map((f) => f.id);
      expect(checkLorebook(out, ids, cardKeys, medium), key).toEqual([]);
    }
  });

  it("ask for more entities, places and minor characters", () => {
    const thin = { ...plan, entities: plan.entities.filter((e) => e.isCard || e.key === "harbor") };
    const problems = checkPlan(thin, medium).join(" | ");
    expect(problems).toMatch(/only 3 entities/);
    expect(problems).toMatch(/locations/);
    expect(problems).toMatch(/minor characters/);
  });

  it("ask for more facts and for each card's own beliefs or claims", () => {
    const few = { facts: facts.facts.filter((f) => f.layer !== "belief" && f.layer !== "claim").slice(0, 30) };
    const problems = checkFacts(few, plan, medium).join(" | ");
    expect(problems).toMatch(/only 30 facts/);
    expect(problems).toMatch(/"alpha" holds 0 beliefs\/claims/);
  });

  it("reject one-line entries and sticky everywhere", () => {
    const out = lorebookOutputSchema.parse({
      entries: fixture.lorebooks.world.entries.map((e) => (e.type === "constant" ? e : { ...e, content: "Too short.", sticky: 2 })),
    });
    const ids = out.entries.flatMap((e) => e.factIds);
    const problems = checkLorebook(out, ids, cardKeys, medium).join(" | ");
    expect(problems).toMatch(/entries are under 50 words/);
    expect(problems).toMatch(/are sticky/);
  });

  it("scale with the adventure length", () => {
    const oneShot = requirementsSchema.parse({ maxNpcCards: 4, scale: { length: "one-shot" } });
    const small = { ...plan, entities: plan.entities.slice(0, 8) };
    expect(checkPlan(small, oneShot).filter((p) => p.includes("entities"))).toEqual([]);
    expect(checkPlan(small, medium).some((p) => p.includes("entities"))).toBe(true);
  });
});

describe("fact keys the plan does not have", () => {
  const base = facts.facts[0]!;
  const fact = (id: string, subject: string, statement: string, holder: string | null = null) => ({ ...base, id, subject, statement, holder });

  it("are filed under the closest entity instead of failing the whole registry", () => {
    const fixed = resolveFactKeys(
      {
        facts: [
          ...facts.facts,
          fact("f901", "harbor-master", "The master of the Probe Harbor keeps a second book."),
          fact("f902", "old-lantern-room", "Nobody goes there."),
          fact("f903", "probe-room", "The Probe Tavern and the Probe Office share a wall."),
          fact("f904", "beta", "Thinks the Probe Gamma lied.", "beta-sister"),
          fact("f905", "zzz-unknown", "Nothing anyone would recognise."),
        ],
      },
      plan,
    );
    const byId = (id: string) => fixed.facts.find((f) => f.id === id)!;
    expect(byId("f901").subject).toBe("harbor");
    expect(byId("f902").subject).toBe("lantern");
    // Shared words tie ("probe"), so the entity the statement names first wins.
    expect(byId("f903").subject).toBe("tavern");
    expect(byId("f904").holder).toBe("beta");
    expect(byId("f905").subject).toBe("zzz-unknown");
    expect(fixed.facts.slice(0, facts.facts.length)).toEqual(facts.facts);
    expect(checkFacts(fixed, plan, medium).filter((p) => p.includes("not an entity key"))).toEqual([expect.stringContaining("f905")]);
  });
});
