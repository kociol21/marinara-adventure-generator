import { describe, expect, it } from "vitest";
import { requirementsSchema } from "@adv/shared";
import { brief, narrativeVoiceEntry, voiceRule } from "../src/pipeline/prompts.ts";

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
