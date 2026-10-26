import type { ProjectUsage, UsageEstimate, UsageTotals } from "@adv/shared";
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
     * from the calls that recorded them), priced at the text model assigned now.
     */
    estimate(excludeProjectId = ""): UsageEstimate {
      const rows = (finished.all(excludeProjectId) as unknown as CallRow[]).filter(isGeneration);
      const projects = new Set(rows.map((r) => r.project_id));
      const n = projects.size;
      const assignment = connections.listAssignments().find((a) => a.task === "text");
      const model = assignment
        ? connections.listModels(assignment.connectionId, "text").find((m) => m.modelId === assignment.modelId)
        : undefined;
      const billing = model?.billing ?? "unknown";
      const base = { basedOn: n, model: assignment?.modelId ?? null, billing } as const;
      if (!n) return { ...base, requests: 0, images: 0, inputTokens: null, outputTokens: null, costUsd: null, quotaTokens: null };

      const text = rows.filter((r) => r.task === "text");
      const measured = text.filter((r) => r.input_tokens != null);
      const requests = Math.round(rows.length / n);
      const images = Math.round(rows.filter((r) => r.task === "image").length / n);
      const textPerRun = text.length / n;
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      if (measured.length) {
        inputTokens = Math.round((measured.reduce((s, r) => s + r.input_tokens!, 0) / measured.length) * textPerRun);
        outputTokens = Math.round((measured.reduce((s, r) => s + (r.output_tokens ?? 0), 0) / measured.length) * textPerRun);
      }
      let costUsd: number | null = null;
      let quotaTokens: number | null = null;
      if (inputTokens != null && outputTokens != null) {
        if (billing === "subscription") quotaTokens = Math.round(inputTokens * (model?.quotaMultiplier ?? 1));
        else if (billing === "free") costUsd = 0;
        else if (model?.priceIn != null && model.priceOut != null) costUsd = (inputTokens * model.priceIn + outputTokens * model.priceOut) / 1_000_000;
      }
      return { ...base, requests, images, inputTokens, outputTokens, costUsd, quotaTokens };
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
