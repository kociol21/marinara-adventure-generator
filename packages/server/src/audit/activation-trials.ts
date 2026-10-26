import type { AdventurePackage, LorebookEntryDraft } from "@adv/shared";
import { simulateActivation } from "../marinara/simulate.ts";
import type { AuditFinding } from "./units.ts";

/**
 * Representative triggering trials (acceptance criterion 6), run on the activation simulator:
 * - hit: each keyword entry fires when its own first key (plus what its AND logic needs) is said;
 * - miss: ordinary small talk that names nothing in the adventure fires no keyword entry;
 * - private: an entry tied to a character stays out when that character is not the one replying.
 * Cheap and deterministic, so it runs on every report instead of inside the model audit.
 */

/** Small talk that names no place, person or object of any adventure. */
export const NEUTRAL_LINES = [
  "Hello. I take a seat and wait for a moment.",
  "I nod, say thanks, and ask how the day has been.",
  "We talk about nothing in particular for a while.",
  "I stretch, yawn, and look at my hands.",
];

export interface TrialResult {
  hits: { run: number; failed: number };
  misses: { run: number; failed: number };
  private: { run: number; failed: number };
  findings: AuditFinding[];
}

const plainKey = (e: LorebookEntryDraft) => e.keys.find((k) => k.trim() && !e.useRegex);

function hitMessage(e: LorebookEntryDraft, key: string): string {
  const secondary =
    e.type !== "selective" || e.secondaryKeys.length === 0
      ? []
      : e.selectiveLogic === "and_all"
        ? e.secondaryKeys
        : e.selectiveLogic === "and_any"
          ? e.secondaryKeys.slice(0, 1)
          : [];
  return [`I ask about ${key}.`, ...secondary.map((s) => `Then ${s}.`)].join(" ");
}

export function runActivationTrials(pkg: AdventurePackage): TrialResult {
  const all = pkg.characters.map((c) => c.key);
  const out: TrialResult = { hits: { run: 0, failed: 0 }, misses: { run: 0, failed: 0 }, private: { run: 0, failed: 0 }, findings: [] };
  let n = 0;
  const finding = (lbName: string, lbKey: string, index: number, summary: string, detail: string) =>
    out.findings.push({
      id: `trial-${++n}`,
      area: "activation",
      severity: "minor",
      source: "code",
      target: `lorebook:${lbKey}`,
      where: `Lorebook: ${lbName}, entry #${index + 1}`,
      summary: `Lorebook: ${lbName}, entry #${index + 1} ${summary}`,
      detail,
      fix: null,
    });

  for (const lb of pkg.lorebooks) {
    lb.entries.forEach((e, i) => {
      if (e.type === "constant" || e.decision?.mode === "trigger") return;
      const key = plainKey(e);
      if (!key) return;
      const respond = e.privateTo.length ? e.privateTo : all;
      // Losing an inclusion-group draw still counts: Marinara picks one member of the group at random.
      const fires = (text: string, responding: string[]) => {
        const r = simulateActivation(pkg, [{ role: "user", content: text }], { activeCardKeys: all, respondingCardKeys: responding }).entries.find(
          (x) => x.lorebookKey === lb.key && x.entryKey === e.key,
        );
        return r?.status === "activated" || (r?.status === "blocked" && r.reason === "group");
      };

      out.hits.run++;
      if (!fires(hitMessage(e, key), respond)) {
        out.hits.failed++;
        finding(lb.name, lb.key, i, "does not fire on its own key.", `Key "${key}" with message "${hitMessage(e, key)}" did not activate ${e.key}.`);
      }

      if (e.privateTo.length) {
        const others = all.filter((k) => !e.privateTo.includes(k));
        if (others.length) {
          out.private.run++;
          if (fires(hitMessage(e, key), others)) {
            out.private.failed++;
            finding(lb.name, lb.key, i, "reaches characters it is not meant for.", `${e.key} fired while only ${others.join(", ")} replied.`);
          }
        }
      }
    });

    // One miss trial per lorebook and line; each entry that fires is reported once.
    const stray = new Map<string, string>();
    for (const line of NEUTRAL_LINES) {
      out.misses.run++;
      const result = simulateActivation(pkg, [{ role: "user", content: line }], { activeCardKeys: all });
      const fired = result.entries.filter((x) => x.lorebookKey === lb.key && x.status === "activated" && x.source === "keyword");
      if (fired.length) out.misses.failed++;
      for (const x of fired) if (!stray.has(x.entryKey)) stray.set(x.entryKey, `"${line}" matched ${x.matchedKeys.join(", ")}.`);
    }
    for (const [entryKey, detail] of stray) {
      const i = lb.entries.findIndex((e) => e.key === entryKey);
      finding(lb.name, lb.key, i, "fires on ordinary small talk; its keys are too general.", detail);
    }
  }
  return out;
}

export function describeTrials(t: TrialResult): string {
  const part = (label: string, r: { run: number; failed: number }) => `${r.run} ${label}${r.failed ? ` (${r.failed} failed)` : ""}`;
  return `Lorebook trigger trials (activation simulator): ${part("own-key hits", t.hits)}, ${part("small-talk misses", t.misses)}, ${part("private-lore isolation", t.private)}`;
}
