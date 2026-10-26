import { useState, type ReactNode } from "react";
import {
  horrorSchema,
  lengthSchema,
  povSchema,
  romanceSchema,
  sexualContentSchema,
  styleIntensitySchema,
  violenceSchema,
  type Requirements,
} from "@adv/shared";

const list = (value: string) =>
  value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
const lines = (value: string) =>
  value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function RequirementsForm({
  initial,
  assumptions,
  saving,
  onSave,
  onCancel,
}: {
  initial: Requirements;
  assumptions: string[];
  saving: boolean;
  onSave: (r: Requirements, assumptions: string[]) => void;
  onCancel: () => void;
}) {
  const [r, setR] = useState<Requirements>(structuredClone(initial));
  // Comma/line lists are edited as text and parsed on save, so typing a comma is not swallowed.
  const [subgenres, setSubgenres] = useState(initial.subgenres.join(", "));
  const [tone, setTone] = useState(initial.tone.join(", "));
  const [inspirations, setInspirations] = useState(initial.narration.inspirations.join(", "));
  const [hardLimits, setHardLimits] = useState(initial.content.hardLimits.join("\n"));
  const [mustInclude, setMustInclude] = useState(initial.mustInclude.join("\n"));
  const [assumed, setAssumed] = useState(assumptions.join("\n"));

  const set = <K extends keyof Requirements>(key: K, value: Requirements[K]) => setR((cur) => ({ ...cur, [key]: value }));
  const setIn = <K extends "narration" | "setting" | "protagonist" | "scale" | "content">(
    key: K,
    patch: Partial<Requirements[K]>,
  ) => setR((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } }));

  const save = () =>
    onSave(
      {
        ...r,
        subgenres: list(subgenres),
        tone: list(tone),
        narration: { ...r.narration, inspirations: list(inspirations) },
        content: { ...r.content, hardLimits: lines(hardLimits) },
        mustInclude: lines(mustInclude),
      },
      lines(assumed),
    );

  return (
    <div className="req-form">
      <Field label="Genre">
        <input value={r.genre} onChange={(e) => set("genre", e.target.value)} />
      </Field>
      <Field label="Subgenres (comma-separated)">
        <input value={subgenres} onChange={(e) => setSubgenres(e.target.value)} />
      </Field>
      <Field label="Tone (comma-separated)">
        <input value={tone} onChange={(e) => setTone(e.target.value)} />
      </Field>
      <div className="row">
        <Field label="Point of view">
          <Choice value={r.narration.pov} options={povSchema.options} onChange={(pov) => setIn("narration", { pov })} />
        </Field>
        <Field label="Tense">
          <Choice value={r.narration.tense} options={["present", "past"] as const} onChange={(tense) => setIn("narration", { tense })} />
        </Field>
      </div>
      <Field label="Prose voice (rhythm, imagery, diction, dialogue)">
        <input
          placeholder="e.g. terse hard-boiled sentences, wry similes, rain-soaked imagery"
          value={r.narration.style}
          onChange={(e) => setIn("narration", { style: e.target.value })}
        />
      </Field>
      <div className="row">
        <Field label="Style inspirations (comma-separated)">
          <input placeholder="e.g. Raymond Chandler, Dashiell Hammett" value={inspirations} onChange={(e) => setInspirations(e.target.value)} />
        </Field>
        <Field label="Style in cards and lorebooks">
          <Choice
            value={r.narration.intensity}
            options={styleIntensitySchema.options}
            onChange={(intensity) => setIn("narration", { intensity })}
          />
        </Field>
      </div>
      <Field label="Era">
        <input value={r.setting.era} onChange={(e) => setIn("setting", { era: e.target.value })} />
      </Field>
      <Field label="Place">
        <input value={r.setting.place} onChange={(e) => setIn("setting", { place: e.target.value })} />
      </Field>
      <Field label="Technology">
        <input value={r.setting.technology} onChange={(e) => setIn("setting", { technology: e.target.value })} />
      </Field>
      <Field label="Magic & the fantastic">
        <input value={r.setting.supernatural} onChange={(e) => setIn("setting", { supernatural: e.target.value })} />
      </Field>
      <Field label="Starting situation">
        <textarea rows={3} value={r.startingSituation} onChange={(e) => set("startingSituation", e.target.value)} />
      </Field>
      <div className="row">
        <Field label="Protagonist">
          <Choice value={r.protagonist.mode} options={["new", "existing"] as const} onChange={(mode) => setIn("protagonist", { mode })} />
        </Field>
        <Field label="Max NPC cards">
          <input
            type="number"
            min={1}
            max={8}
            value={r.maxNpcCards}
            onChange={(e) => set("maxNpcCards", Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
          />
        </Field>
        <Field label="Length">
          <Choice value={r.scale.length} options={lengthSchema.options} onChange={(length) => setIn("scale", { length })} />
        </Field>
      </div>
      <Field label="Protagonist notes">
        <input value={r.protagonist.notes} onChange={(e) => setIn("protagonist", { notes: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Violence">
          <Choice value={r.content.violence} options={violenceSchema.options} onChange={(violence) => setIn("content", { violence })} />
        </Field>
        <Field label="Romance">
          <Choice value={r.content.romance} options={romanceSchema.options} onChange={(romance) => setIn("content", { romance })} />
        </Field>
        <Field label="Sexual content">
          <Choice
            value={r.content.sexualContent}
            options={sexualContentSchema.options}
            onChange={(sexualContent) => setIn("content", { sexualContent })}
          />
        </Field>
        <Field label="Horror">
          <Choice value={r.content.horror} options={horrorSchema.options} onChange={(horror) => setIn("content", { horror })} />
        </Field>
      </div>
      <Field label="Hard limits (one per line)">
        <textarea rows={2} value={hardLimits} onChange={(e) => setHardLimits(e.target.value)} />
      </Field>
      <Field label="Portrait style">
        <input value={r.visualStyle} onChange={(e) => set("visualStyle", e.target.value)} />
      </Field>
      <label className="field checkbox">
        <input type="checkbox" checked={r.lorebookVectors} onChange={(e) => set("lorebookVectors", e.target.checked)} />
        <span>
          Meaning-based lorebook matching (vectors)
          <small className="muted">
            World and Characters entries also come up when the chat is about them in other words. Plot stays on keywords, so
            clues surface only where they are found. Marinara builds the vectors with an embedding model when you push. Changing
            this regenerates nothing.
          </small>
        </span>
      </label>
      <Field label="Details you want included (one per line)">
        <textarea rows={2} value={mustInclude} onChange={(e) => setMustInclude(e.target.value)} />
      </Field>
      <Field label="Defaults chosen for you (one per line)">
        <textarea rows={3} value={assumed} onChange={(e) => setAssumed(e.target.value)} />
      </Field>
      <div className="row">
        <button className="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button onClick={save} disabled={saving}>
          Save changes
        </button>
      </div>
    </div>
  );
}
