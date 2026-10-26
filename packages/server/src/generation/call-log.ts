import { TASK_CAPABILITY, type Task } from "@adv/shared";
import type { Db } from "../db/database.ts";
import type { ConnectionsRepo } from "../repos/connections.ts";
import type { Usage } from "../connections/adapters.ts";

export interface CallRecord {
  projectId: string | null;
  task: Task;
  purpose: string;
  connectionId: string;
  modelId: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
  usage?: Usage | null;
}

/**
 * The usage log: one row per model request, with tokens and what it cost. The cost and billing
 * are fixed when the call is made, from the provider's reported cost or the catalog's list price,
 * so a later price change does not rewrite history. Subscription calls also record the quota
 * they used (input tokens times the model's quota multiplier).
 */
export function createCallLog(db: Db, connections: ConnectionsRepo) {
  const insert = db.prepare(`
    INSERT INTO llm_call (project_id, task, purpose, connection_id, model_id, ok, latency_ms, error, created_at,
      input_tokens, output_tokens, cost_usd, billing, quota_tokens, estimated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return (call: CallRecord): void => {
    const model = connections.listModels(call.connectionId, TASK_CAPABILITY[call.task]).find((m) => m.modelId === call.modelId);
    const billing = model?.billing ?? "unknown";
    const u = call.usage ?? null;
    let cost: number | null = null;
    // Subscription calls are paid for by quota, not per request.
    if (billing === "subscription" || billing === "free") cost = u ? 0 : null;
    else if (u?.costUsd != null) cost = u.costUsd;
    else if (u && model?.priceIn != null && model.priceOut != null) cost = (u.inputTokens * model.priceIn + u.outputTokens * model.priceOut) / 1_000_000;
    const quota = billing === "subscription" && u ? Math.round(u.inputTokens * (model?.quotaMultiplier ?? 1)) : null;
    insert.run(
      call.projectId,
      call.task,
      call.purpose,
      call.connectionId,
      call.modelId,
      call.ok ? 1 : 0,
      call.latencyMs,
      call.error,
      new Date().toISOString(),
      u?.inputTokens ?? null,
      u?.outputTokens ?? null,
      cost,
      billing,
      quota,
      u?.estimated ? 1 : 0,
    );
  };
}

export type CallLog = ReturnType<typeof createCallLog>;
