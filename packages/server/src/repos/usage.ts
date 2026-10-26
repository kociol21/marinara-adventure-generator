import { STORY_PURPOSES, type ProjectUsage, type UsageEstimate, type UsageTotals } from "@adv/shared";
import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "./connections.ts";

interface CallRow {
  project_id: string;
  task: string;
  purpose: string;
  ok: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  billing: string | null;
  quota_tokens: number | null;
  estimated: number;
}

/** "lorebook:plot" → "lorebook", "avatar:x:check" → "avatar", "audit-review" → "audit". */
export function stageOf(purpose: string): string {
  if (purpose.startsWith("audit")) return "audit";
  return purpose.split(":")[0] || "other";
}

const empty = (): UsageTotals => ({
  requests: 0,
  failed: 0,
  images: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
  quotaTokens: 0,
  estimated: false,
});

function add(t: UsageTotals, r: CallRow): void {
  t.requests++;
  if (!r.ok) t.failed++;
  if (r.task === "image") t.images++;
  t.inputTokens += r.input_tokens ?? 0;
  t.outputTokens += r.output_tokens ?? 0;
  t.quotaTokens += r.quota_tokens ?? 0;
  if (r.estimated) t.estimated = true;
  // Subscription and free calls cost nothing extra; failed calls without usage are not billed.
  if (r.cost_usd != null) t.costUsd += r.cost_usd;
  else if (r.billing !== "subscription" && r.billing !== "free" && (r.ok || r.input_tokens != null)) t.unpricedCalls++;
}

/** The generation run, not the interview before it: what "Generate adventure" will spend. */
const isGeneration = (r: CallRow) => stageOf(r.purpose) !== "interview";

export function createUsageRepo(db: Db, connections: ConnectionsRepo) {
  const byProject = db.prepare(
    `SELECT project_id, task, purpose, ok, input_tokens, output_tokens, cost_usd, billing, quota_tokens, estimated
     FROM llm_call WHERE project_id = ? ORDER BY id`,
  );
  const finished = db.prepare(
    `SELECT c.project_id, c.task, c.purpose, c.ok, c.input_tokens, c.output_tokens, c.cost_usd, c.billing, c.quota_tokens, c.estimated
     FROM llm_call c JOIN project p ON p.id = c.project_id
     WHERE p.status IN ('ready', 'exported') AND p.id <> ?`,
  );

  return {
    forProject(projectId: string): ProjectUsage {
      const rows = byProject.all(projectId) as unknown as CallRow[];
      const total = empty();
      const stages = new Map<string, UsageTotals>();
      for (const r of rows) {
        add(total, r);
        const key = stageOf(r.purpose);
        if (!stages.has(key)) stages.set(key, empty());
        add(stages.get(key)!, r);
      }
      return { total, stages: [...stages].map(([stage, t]) => ({ stage, ...t })) };
    },

    /**
     * Averages over finished adventures (requests and images per run, tokens per text request,
     * from the calls that recorded them), priced at the models assigned now: story-stage calls at
     * the story model when one is assigned, everything else at the text model.
     */
    estimate(excludeProjectId = ""): UsageEstimate {
      const rows = (finished.all(excludeProjectId) as unknown as CallRow[]).filter(isGeneration);
      const projects = new Set(rows.map((r) => r.project_id));
      const n = projects.size;
      const assignments = connections.listAssignments();
      const modelFor = (task: "text" | "story") => {
        const a = assignments.find((x) => x.task === task);
        return a ? { id: a.modelId, info: connections.listModels(a.connectionId, "text").find((m) => m.modelId === a.modelId) } : null;
      };
      const textModel = modelFor("text");
      const storyModel = modelFor("story");
      const billing = textModel?.info?.billing ?? "unknown";
      const base = { basedOn: n, model: textModel?.id ?? null, storyModel: storyModel?.id ?? null, billing } as const;
      if (!n) return { ...base, requests: 0, images: 0, inputTokens: null, outputTokens: null, costUsd: null, quotaTokens: null };

      const text = rows.filter((r) => r.task === "text" || r.task === "story");
      const requests = Math.round(rows.length / n);
      const images = Math.round(rows.filter((r) => r.task === "image").length / n);
      const groups = storyModel
        ? [
            { model: storyModel, rows: text.filter((r) => STORY_PURPOSES.has(r.purpose)) },
            { model: textModel, rows: text.filter((r) => !STORY_PURPOSES.has(r.purpose)) },
          ]
        : [{ model: textModel, rows: text }];

      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let costUsd: number | null = null;
      let quotaTokens: number | null = null;
      let unpriced = false;
      for (const g of groups) {
        const measured = g.rows.filter((r) => r.input_tokens != null);
        if (!measured.length) {
          if (g.rows.length) unpriced = true;
          continue;
        }
        const perRun = g.rows.length / n;
        const inT = Math.round((measured.reduce((s, r) => s + r.input_tokens!, 0) / measured.length) * perRun);
        const outT = Math.round((measured.reduce((s, r) => s + (r.output_tokens ?? 0), 0) / measured.length) * perRun);
        inputTokens = (inputTokens ?? 0) + inT;
        outputTokens = (outputTokens ?? 0) + outT;
        const m = g.model?.info;
        if (m?.billing === "subscription") quotaTokens = (quotaTokens ?? 0) + Math.round(inT * (m.quotaMultiplier ?? 1));
        else if (m?.billing === "free") costUsd ??= 0;
        else if (m?.priceIn != null && m.priceOut != null) costUsd = (costUsd ?? 0) + (inT * m.priceIn + outT * m.priceOut) / 1_000_000;
        else unpriced = true;
      }
      // A partial dollar figure would understate the run, so it is all or nothing.
      if (unpriced) costUsd = null;
      return { ...base, requests, images, inputTokens, outputTokens, costUsd, quotaTokens };
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
