import type { AdventurePackage, LorebookDraft, LorebookEntryDraft } from "@adv/shared";
import { privateTag } from "./native.ts";
import { DEFAULT_CHAT_LOREBOOK_BUDGET, estimateTokens } from "./tokens.ts";

/**
 * Offline model of Marinara's lorebook activation (services/lorebook/keyword-scanner.ts and the
 * budget selector in services/lorebook/index.ts, Marinara 2.5.1). It answers "would this entry
 * fire for this chat, and would it fit the budget" without a running Marinara, so the generator
 * can test activation before export. The differential test in test/integration checks it
 * against a real Marinara.
 *
 * Deliberate simplifications, reported in results instead of guessed:
 * - probability < 100 counts as firing, flagged `chance`;
 * - decision statements cannot be evaluated offline: Require entries are flagged
 *   `needsDecision`, Trigger-only entries are reported as `decision-only`;
 * - group winners in Marinara are random/seeded; here the lowest order wins, flagged `groupPick`;
 * - semantic (vector) matching is not modelled;
 * - timing: like Marinara's test tool, sticky/cooldown are ignored; `delay` is applied only when
 *   `messageIndex` is given (entry blocked while messageIndex < delay).
 */

export interface SimMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SimOptions {
  /** Cards present in the chat (by package key). */
  activeCardKeys: string[];
  /** Cards whose reply is being generated; defaults to all active cards. Private entries filter on these. */
  respondingCardKeys?: string[];
  /** 0-based index of the message being generated, to apply entry delays. Omit to ignore timing. */
  messageIndex?: number;
  /** Marinara's chat-wide lorebook budget (default 8192; 0 = unlimited). */
  chatTokenBudget?: number;
}

export type SimStatus = "activated" | "blocked" | "unmatched";
export type SimBlockReason = "filters" | "secondary-keys" | "delay" | "group" | "decision-only";
export type SimBudget = "selected" | "lorebook-budget" | "chat-budget" | "both-budgets" | "entry-limit";

export interface SimEntryResult {
  lorebookKey: string;
  entryKey: string;
  status: SimStatus;
  reason?: SimBlockReason;
  source?: "constant" | "keyword" | "recursive";
  matchedKeys: string[];
  /** Matched the latest user message (Marinara loads these before other keyword matches). */
  matchedLatestUser: boolean;
  chance?: number;
  needsDecision?: boolean;
  groupPick?: boolean;
  tokens: number;
  budget?: SimBudget;
}

export interface SimResult {
  entries: SimEntryResult[];
  /** Activated entries that made it into the prompt, in injection order. */
  injected: SimEntryResult[];
  totalTokens: number;
}

// ── Keyword matching (port of shared/utils/lorebook-keyword-matching.ts) ──

const wordChar = /[\p{L}\p{N}_]/u;

export interface MatchOptions {
  useRegex: boolean;
  matchWholeWords: boolean;
  caseSensitive: boolean;
}

function literal(keyword: string, text: string, o: MatchOptions): boolean {
  return o.caseSensitive ? text.includes(keyword) : text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

export function testKeyword(keyword: string, text: string, o: MatchOptions): boolean {
  const k = keyword.trim();
  if (!k) return false;
  try {
    if (o.useRegex) return new RegExp(k, o.caseSensitive ? "g" : "gi").test(text);
    if (o.matchWholeWords) {
      const needle = o.caseSensitive ? k : k.toLocaleLowerCase();
      const hay = o.caseSensitive ? text : text.toLocaleLowerCase();
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu");
      for (const m of hay.matchAll(re)) {
        const start = m.index ?? -1;
        if (start < 0) continue;
        const before = Array.from(hay.slice(0, start)).pop() ?? "";
        const after = Array.from(hay.slice(start + m[0].length))[0] ?? "";
        if (!wordChar.test(before) && !wordChar.test(after)) return true;
      }
      return false;
    }
    return literal(k, text, o);
  } catch {
    return literal(k, text, o);
  }
}

function matchedPrimary(entry: LorebookEntryDraft, text: string): string[] {
  return entry.keys.filter((k) => testKeyword(k, text, entry));
}

function passesSecondary(entry: LorebookEntryDraft, text: string): boolean {
  if (entry.type !== "selective" || entry.secondaryKeys.length === 0) return true;
  const hits = entry.secondaryKeys.map((k) => testKeyword(k, text, entry));
  switch (entry.selectiveLogic) {
    case "and_any":
      return hits.some(Boolean);
    case "and_all":
      return hits.every(Boolean);
    case "not_any":
      return !hits.some(Boolean);
    case "not_all":
      return !hits.every(Boolean);
  }
}

// ── Scanning ──

function windowText(messages: SimMessage[], depth: number): string {
  return (depth > 0 ? messages.slice(-depth) : messages).map((m) => m.content).join("\n");
}

interface Candidate {
  lb: LorebookDraft;
  entry: LorebookEntryDraft;
  result: SimEntryResult;
}

export function simulateActivation(pkg: AdventurePackage, messages: SimMessage[], options: SimOptions): SimResult {
  const responding = options.respondingCardKeys ?? options.activeCardKeys;
  const activeTags = new Set(responding.map((k) => privateTag(pkg.title, k).toLowerCase()));
  for (const card of pkg.characters) {
    if (responding.includes(card.key)) for (const t of card.tags) activeTags.add(t.toLowerCase());
  }
  const latestUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const results: SimEntryResult[] = [];
  const activated: Candidate[] = [];

  for (const lb of pkg.lorebooks) {
    const depthOf = (e: LorebookEntryDraft) => e.scanDepth ?? lb.scanDepth;
    const passesFilters = (e: LorebookEntryDraft) =>
      e.privateTo.length === 0 || e.privateTo.some((k) => activeTags.has(privateTag(pkg.title, k).toLowerCase()));
    const delayed = (e: LorebookEntryDraft) =>
      options.messageIndex !== undefined && e.delay !== null && e.delay > 0 && options.messageIndex < e.delay;

    const byKey = new Map<string, SimEntryResult>();
    const fired: Candidate[] = [];

    const evaluate = (e: LorebookEntryDraft, text: string, recursive: boolean): SimEntryResult => {
      const base: SimEntryResult = {
        lorebookKey: lb.key,
        entryKey: e.key,
        status: "unmatched",
        matchedKeys: [],
        matchedLatestUser: false,
        tokens: estimateTokens(e.content),
        ...(e.probability !== null && e.probability < 100 ? { chance: e.probability } : {}),
        ...(e.decision?.mode === "require" ? { needsDecision: true } : {}),
      };
      if (e.type === "constant") {
        if (!passesFilters(e)) return { ...base, status: "blocked", reason: "filters" };
        if (delayed(e)) return { ...base, status: "blocked", reason: "delay" };
        return { ...base, status: "activated", source: recursive ? "recursive" : "constant", matchedKeys: ["[constant]"] };
      }
      const keys = matchedPrimary(e, text);
      if (keys.length === 0) {
        return e.decision?.mode === "trigger" ? { ...base, status: "blocked", reason: "decision-only" } : base;
      }
      const matched = { ...base, matchedKeys: keys, matchedLatestUser: !recursive && matchedPrimary(e, latestUser).length > 0 };
      if (!passesFilters(e)) return { ...matched, status: "blocked", reason: "filters" };
      if (delayed(e)) return { ...matched, status: "blocked", reason: "delay" };
      if (!passesSecondary(e, text)) return { ...matched, status: "blocked", reason: "secondary-keys" };
      return { ...matched, status: "activated", source: recursive ? "recursive" : "keyword" };
    };

    for (const e of lb.entries) {
      const r = evaluate(e, windowText(messages, depthOf(e)), false);
      byKey.set(e.key, r);
      if (r.status === "activated") fired.push({ lb, entry: e, result: r });
    }

    if (lb.recursiveScanning) {
      let fresh = fired.slice();
      for (let depth = 0; depth < lb.maxRecursionDepth && fresh.length > 0; depth++) {
        const content = fresh
          .filter((c) => c.entry.recursion)
          .map((c) => c.entry.content)
          .join("\n");
        if (!content) break;
        fresh = [];
        for (const e of lb.entries) {
          if (byKey.get(e.key)?.status === "activated") continue;
          const r = evaluate(e, content, true);
          if (r.status !== "activated") continue;
          byKey.set(e.key, r);
          const c = { lb, entry: e, result: r };
          fired.push(c);
          fresh.push(c);
        }
      }
    }

    // Inclusion groups: one winner per group per lorebook scan.
    const groups = new Map<string, Candidate[]>();
    for (const c of fired) if (c.entry.group) groups.set(c.entry.group, [...(groups.get(c.entry.group) ?? []), c]);
    for (const members of groups.values()) {
      const sorted = [...members].sort((a, b) => a.entry.order - b.entry.order || a.entry.key.localeCompare(b.entry.key));
      sorted.forEach((c, i) => {
        if (members.length > 1) c.result.groupPick = true;
        if (i > 0) {
          c.result.status = "blocked";
          c.result.reason = "group";
        }
      });
    }

    for (const e of lb.entries) results.push(byKey.get(e.key)!);
    activated.push(...fired.filter((c) => c.result.status === "activated"));
  }

  // ── Budget selection: constants, then latest-user matches, then order ──
  const chatBudget = options.chatTokenBudget ?? DEFAULT_CHAT_LOREBOOK_BUDGET;
  const perLbTokens = new Map<string, number>();
  const perLbCount = new Map<string, number>();
  let total = 0;
  const ordered = [...activated].sort((a, b) => {
    const ac = a.entry.type === "constant" ? 0 : 1;
    const bc = b.entry.type === "constant" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    if (a.result.matchedLatestUser !== b.result.matchedLatestUser) return a.result.matchedLatestUser ? -1 : 1;
    return a.entry.order - b.entry.order;
  });
  for (const { lb, entry, result } of ordered) {
    if (!entry.content.trim()) continue;
    const count = perLbCount.get(lb.key) ?? 0;
    if (count >= lb.entryLimit) {
      result.budget = "entry-limit";
      continue;
    }
    const used = perLbTokens.get(lb.key) ?? 0;
    const overLb = lb.tokenBudget > 0 && used + result.tokens > lb.tokenBudget;
    const overChat = chatBudget > 0 && total + result.tokens > chatBudget;
    if (overLb || overChat) {
      result.budget = overLb && overChat ? "both-budgets" : overLb ? "lorebook-budget" : "chat-budget";
      continue;
    }
    result.budget = "selected";
    perLbTokens.set(lb.key, used + result.tokens);
    perLbCount.set(lb.key, count + 1);
    total += result.tokens;
  }

  const injected = ordered
    .filter((c) => c.result.budget === "selected")
    .sort((a, b) => a.entry.order - b.entry.order)
    .map((c) => c.result);
  return { entries: results, injected, totalTokens: total };
}
