import { describe, expect, it } from "vitest";
import { requirementsSchema } from "@adv/shared";
import { checkFacts, checkLorebook, checkPlan } from "../src/pipeline/stages.ts";
import { planSchema, factsSchema, lorebookOutputSchema } from "../src/pipeline/schemas.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const medium = requirementsSchema.parse({ maxNpcCards: 4, scale: { length: "medium" } });
const plan = planSchema.parse(fixture.plan);
const facts = factsSchema.parse(fixture.facts);
const cardKeys = new Set(["alpha", "beta"]);

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
