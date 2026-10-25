import type { Requirements } from "@adv/shared";

const LENGTH: Record<Requirements["scale"]["length"], string> = {
  "one-shot": "One-shot (a single short session)",
  short: "Short (a session or two)",
  medium: "Medium (a few sessions)",
  long: "Long (a campaign)",
};

const POV: Record<Requirements["narration"]["pov"], string> = {
  second: "second person (“you”)",
  third: "third person",
  first: "first person",
};

const LABELS: Record<string, string> = {
  genre: "genre",
  tone: "tone",
  "setting.place": "place",
  "setting.era": "era",
  startingSituation: "starting situation",
};

/** Spoiler-free by construction: requirements hold preferences only, plus what the player imposed. */
export function RequirementsSummary({
  requirements: r,
  assumptions,
  missing,
}: {
  requirements: Requirements;
  assumptions: string[];
  missing: string[];
}) {
  const rows: Array<[string, string]> = [
    ["Genre", [r.genre, ...r.subgenres].filter(Boolean).join(" · ")],
    ["Tone", r.tone.join(", ")],
    ["Narration", `${POV[r.narration.pov]}, ${r.narration.tense} tense`],
    [
      "Prose style",
      [
        r.narration.style,
        r.narration.inspirations.length ? `in the manner of ${r.narration.inspirations.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" — ")
        .concat(r.narration.style || r.narration.inspirations.length ? ` (${r.narration.intensity} in cards and lorebooks, full in play text)` : ""),
    ],
    ["Era", r.setting.era],
    ["Place", r.setting.place],
    ["Technology", r.setting.technology],
    ["Magic & the fantastic", r.setting.supernatural],
    ["Setting notes", r.setting.notes],
    ["Starting situation", r.startingSituation],
    ["Protagonist", `${r.protagonist.mode === "existing" ? "Your existing persona" : "A new persona"}${r.protagonist.notes ? ` — ${r.protagonist.notes}` : ""}`],
    ["Character cards", `Up to ${r.maxNpcCards} full NPC cards (more minor characters can appear in lorebooks)`],
    ["Length", `${LENGTH[r.scale.length]}${r.scale.notes ? ` — ${r.scale.notes}` : ""}`],
    [
      "Content",
      `Violence: ${r.content.violence} · Romance: ${r.content.romance} · Sexual content: ${r.content.sexualContent} · Horror: ${r.content.horror}`,
    ],
    ["Hard limits", r.content.hardLimits.join("; ")],
    ["Content notes", r.content.notes],
    ["Portrait style", r.visualStyle],
    ["You asked for", r.mustInclude.join("; ")],
    ["Language", "English"],
  ];

  return (
    <div>
      <dl className="facts">
        {rows
          .filter(([, value]) => value.trim())
          .map(([label, value]) => (
            <div key={label} className="fact-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {missing.length > 0 && <p className="error">Still open: {missing.map((m) => LABELS[m] ?? m).join(", ")}.</p>}
      {assumptions.length > 0 && (
        <div className="assumptions">
          <strong>Defaults chosen for you</strong>
          <ul>
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
