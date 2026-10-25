import { adventurePackageSchema, type AdventurePackage, type AdventurePackageInput } from "@adv/shared";

/**
 * Neutral probe adventure: no real story, every value is a marker. It exercises the activation
 * features the exporter maps (constant, whole words, selective logic, private tag filters,
 * recursion, groups, delay, budgets) so the differential test can compare against Marinara.
 */
export const probeInput: AdventurePackageInput = {
  title: "Probe Harbor",
  teaser: "A neutral test package.",
  maxNpcCards: 3,
  openingCardKey: "alpha",
  characters: [
    {
      key: "alpha",
      name: "Probe Alpha",
      tags: ["probe"],
      description: "ALPHA_DESCRIPTION",
      personality: "ALPHA_PERSONALITY",
      backstory: "ALPHA_BACKSTORY",
      appearance: "ALPHA_APPEARANCE",
      scenario: "ALPHA_SCENARIO",
      firstMessage: "ALPHA_FIRST_MESSAGE",
      exampleDialogue: "<START>\n{{user}}: Hello.\n{{char}}: ALPHA_EXAMPLE",
    },
    {
      key: "beta",
      name: "Probe Beta",
      tags: ["probe"],
      description: "BETA_DESCRIPTION",
      personality: "BETA_PERSONALITY",
      backstory: "BETA_BACKSTORY",
      appearance: "BETA_APPEARANCE",
      scenario: "BETA_SCENARIO",
      firstMessage: "",
      exampleDialogue: "<START>\n{{user}}: Hello.\n{{char}}: BETA_EXAMPLE",
    },
  ],
  persona: {
    name: "Probe Persona",
    description: "PERSONA_DESCRIPTION",
    personality: "PERSONA_PERSONALITY",
    backstory: "PERSONA_BACKSTORY",
    appearance: "PERSONA_APPEARANCE",
    scenario: "PERSONA_SCENARIO",
  },
  lorebooks: [
    {
      key: "world",
      name: "Probe World",
      category: "world",
      scanDepth: 2,
      entries: [
        { key: "premise", name: "Premise", type: "constant", content: "WORLD_PREMISE", order: 10 },
        { key: "lighthouse", name: "Lighthouse", keys: ["lighthouse", "the beacon"], content: "WORLD_LIGHTHOUSE" },
        { key: "ash", name: "Ash", keys: ["Ash"], matchWholeWords: true, content: "WORLD_ASH" },
        {
          key: "harbor-king",
          name: "Harbor king",
          type: "selective",
          keys: ["king"],
          secondaryKeys: ["harbor"],
          selectiveLogic: "and_any",
          matchWholeWords: true,
          content: "WORLD_HARBOR_KING",
        },
        {
          key: "no-storm",
          name: "Calm sea",
          type: "selective",
          keys: ["sea"],
          secondaryKeys: ["storm"],
          selectiveLogic: "not_any",
          matchWholeWords: true,
          content: "WORLD_CALM_SEA",
        },
        { key: "rumor-a", name: "Rumor A", keys: ["rumor"], group: "rumors", order: 50, content: "WORLD_RUMOR_A" },
        { key: "rumor-b", name: "Rumor B", keys: ["rumor"], group: "rumors", order: 60, content: "WORLD_RUMOR_B" },
        { key: "case-ship", name: "Case ship", keys: ["SHIP"], caseSensitive: true, content: "WORLD_CASE_SHIP" },
        { key: "regex-dock", name: "Regex dock", keys: ["\\bdocks?\\b"], useRegex: true, content: "WORLD_REGEX_DOCK" },
      ],
    },
    {
      key: "plot",
      name: "Probe Plot",
      category: "uncategorized",
      scanDepth: 4,
      recursiveScanning: true,
      maxRecursionDepth: 2,
      entries: [
        {
          key: "alpha-secret",
          name: "Alpha private",
          keys: ["lighthouse"],
          privateTo: ["alpha"],
          content: "PLOT_ALPHA_PRIVATE",
        },
        {
          key: "chain-start",
          name: "Chain start",
          keys: ["ledger"],
          recursion: true,
          content: "PLOT_CHAIN mentions the vault",
        },
        { key: "chain-end", name: "Chain end", keys: ["vault"], content: "PLOT_VAULT" },
        { key: "late", name: "Late reveal", keys: ["lighthouse"], delay: 5, content: "PLOT_LATE" },
      ],
    },
  ],
};

export const probePackage: AdventurePackage = adventurePackageSchema.parse(probeInput);

/** Chat scenarios shared by the unit test and the differential test. */
export const probeScenarios: Array<{ name: string; cards: string[]; messages: string[] }> = [
  { name: "alpha at lighthouse", cards: ["alpha"], messages: ["We walk toward the lighthouse."] },
  { name: "beta at lighthouse", cards: ["beta"], messages: ["We walk toward the lighthouse."] },
  { name: "whole word ash", cards: ["alpha"], messages: ["Ash waits.", "The ashes are cold."] },
  { name: "ash inside word only", cards: ["alpha"], messages: ["The ashes are cold. Cash only."] },
  { name: "king with harbor", cards: ["alpha"], messages: ["The king walks the harbor."] },
  { name: "king without harbor", cards: ["alpha"], messages: ["The king is tired."] },
  { name: "sea calm vs storm", cards: ["alpha"], messages: ["The sea is calm."] },
  { name: "sea with storm", cards: ["alpha"], messages: ["The sea, a storm coming."] },
  { name: "rumor group", cards: ["alpha"], messages: ["I heard a rumor."] },
  { name: "case sensitive", cards: ["alpha"], messages: ["A ship and a SHIP."] },
  { name: "case miss", cards: ["alpha"], messages: ["A ship sails."] },
  { name: "regex", cards: ["alpha"], messages: ["Meet me at the docks."] },
  { name: "recursion", cards: ["alpha"], messages: ["Check the ledger."] },
  { name: "scan depth", cards: ["alpha"], messages: ["The lighthouse.", "Two.", "Three."] },
];
