import { describe, expect, it } from "vitest";
import { requirementsSchema } from "@adv/shared";
import { brief, factsPrompt, narrativeVoiceEntry, openingPrompt, planPrompt, voiceRule } from "../src/pipeline/prompts.ts";
import { factsSchema, planSchema } from "../src/pipeline/schemas.ts";
import fixture from "../../../tools/marinara-test/pipeline-fixture.json" with { type: "json" };

const styled = requirementsSchema.parse({
  tone: ["hard-boiled"],
  narration: { style: "terse sentences, wry similes", inspirations: ["Raymond Chandler"], intensity: "light" },
});
const unstyled = requirementsSchema.parse({});

describe("prose voice", () => {
  it("is applied in layers: full in play text, light in reference text, none in planning", () => {
    expect(voiceRule(styled, "play")).toMatch(/fully in the adventure's prose voice/);
    expect(voiceRule(styled, "play")).toMatch(/Raymond Chandler/);
    expect(voiceRule(styled, "descriptive")).toMatch(/light touch/);
    expect(voiceRule({ ...styled, narration: { ...styled.narration, intensity: "strong" } }, "descriptive")).not.toMatch(/light touch/);
    expect(voiceRule(styled, "internal")).toMatch(/plainly/);
    expect(voiceRule(styled, "internal")).not.toMatch(/Chandler/);
  });

  it("never asks to copy an author", () => {
    expect(voiceRule(styled, "play")).toMatch(/Never quote them or reuse their lines, characters or plots/);
    expect(narrativeVoiceEntry(styled)).toMatch(/Do not quote them or borrow their characters or plots/);
  });

  it("carries the voice into every stage brief and skips the entry without a style", () => {
    expect(brief(styled)).toMatch(/Prose voice: terse sentences, wry similes \(in the manner of Raymond Chandler\); intensity light/);
    expect(narrativeVoiceEntry(unstyled)).toBeNull();
  });
});

describe("stories without a mystery", () => {
  const mystery = planSchema.parse({ ...fixture.plan, isMystery: true });
  const romance = planSchema.parse({ ...fixture.plan, isMystery: false, truth: { ...fixture.plan.truth, culprit: null, motive: "", method: "" } });
  const facts = factsSchema.parse(fixture.facts);
  const card = { name: "X", scenario: "", personality: "" };

  it("lets the plan skip the culprit, motive and method unless solving something is the point", () => {
    for (const genre of ["slice of life romance", "dark fantasy", "post-apocalyptic drama"]) {
      const p = planPrompt(requirementsSchema.parse({ genre }));
      expect(p).toMatch(/Set isMystery to true only when the requirements make solving a case the point of play/);
      expect(p).toMatch(/do not invent a crime or puzzle/);
      expect(p).toMatch(/there is always something to discover/);
    }
    expect(planPrompt(requirementsSchema.parse({ genre: "noir detective" }))).toMatch(/This is a mystery: fix the truth now \(culprit, motive, method, timeline\)/);
  });

  it("asks for secrets and relationships instead of a case in facts and the Secret Plot", () => {
    const r = requirementsSchema.parse({});
    expect(factsPrompt(r, romance)).not.toMatch(/the method, the motive|alibis|truth of the case/);
    expect(factsPrompt(r, mystery)).toMatch(/the method, the motive/);
    expect(openingPrompt(r, romance, card, facts)).not.toMatch(/its mystery/);
    expect(openingPrompt(r, romance, card, facts)).toMatch(/no puzzle to solve/);
    expect(openingPrompt(r, mystery, card, facts)).toMatch(/the arc, its mystery, resolution conditions/);
  });
});
