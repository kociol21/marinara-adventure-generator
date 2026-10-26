import { useQuery } from "@tanstack/react-query";
import type { ProjectUsage, UsageEstimate, UsageTotals } from "@adv/shared";
import { api } from "../api.ts";

const STAGE_LABELS: Record<string, string> = {
  interview: "Interview",
  plan: "Plan",
  facts: "Facts",
  clues: "Clues",
  card: "Character cards",
  persona: "Persona",
  lorebook: "Lorebooks",
  opening: "Opening",
  title: "Title",
  avatar: "Portraits",
  audit: "Quality audit",
};

const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function cost(t: UsageTotals): string {
  const known = t.costUsd > 0 ? formatUsd(t.costUsd) : null;
  if (t.unpricedCalls === 0) return known ?? (t.quotaTokens > 0 ? "subscription" : "—");
  return known ? `${known} + unknown` : "unknown";
}

function tokens(t: UsageTotals): string {
  if (t.inputTokens === 0 && t.outputTokens === 0) return "—";
  const approx = t.estimated ? "~" : "";
  return `${approx}${formatTokens(t.inputTokens)} in · ${approx}${formatTokens(t.outputTokens)} out`;
}

/** Requests, tokens and cost of this adventure, per stage. Numbers only, never content. */
export function UsagePanel({ projectId, running }: { projectId: string; running: boolean }) {
  const usage = useQuery({
    queryKey: ["usage", projectId],
    queryFn: () => api.get<ProjectUsage>(`/projects/${projectId}/usage`),
    refetchInterval: running ? 3000 : false,
  });
  const u = usage.data;
  if (!u || u.total.requests === 0) return null;
  const quota = u.total.quotaTokens > 0;
  const untracked = u.stages.some((s) => s.requests > s.images && s.inputTokens === 0);

  return (
    <div className="subpanel usage">
      <h3>Usage</h3>
      <table className="judge-table small">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Requests</th>
            <th>Tokens</th>
            {quota && <th>Quota</th>}
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {u.stages.map((s) => (
            <tr key={s.stage}>
              <td>{stageLabel(s.stage)}</td>
              <td>
                {s.requests}
                {s.images > 0 && ` (${s.images} ${s.images === 1 ? "image" : "images"})`}
                {s.failed > 0 && <span className="muted"> · {s.failed} failed</span>}
              </td>
              <td>{tokens(s)}</td>
              {quota && <td>{s.quotaTokens > 0 ? formatTokens(s.quotaTokens) : "—"}</td>}
              <td>{cost(s)}</td>
            </tr>
          ))}
          <tr className="usage-total">
            <td>Total</td>
            <td>{u.total.requests}</td>
            <td>{tokens(u.total)}</td>
            {quota && <td>{formatTokens(u.total.quotaTokens)}</td>}
            <td>{cost(u.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        Cost uses the price your provider reported, or the model's list price when it reported none.
        {quota && " Quota is input tokens times the model's subscription multiplier."}
        {u.total.estimated && " ~ marks token counts estimated from the request size (the provider reported none)."}
        {untracked && " Requests made before usage tracking have no token counts."}
        {u.total.images > 0 && " Image prices are not tracked."}
      </p>
    </div>
  );
}

/** The forecast sentence for the start dialog, or null when there is nothing to base it on. */
export function estimateText(e: UsageEstimate | undefined): string | null {
  if (!e || e.basedOn === 0) return null;
  const from = `Based on ${e.basedOn} earlier ${e.basedOn === 1 ? "adventure" : "adventures"}, expect about ${e.requests} requests`;
  const images = e.images > 0 ? ` (${e.images} of them ${e.images === 1 ? "an image" : "images"}, if you make portraits)` : "";
  let spend = "";
  if (e.inputTokens != null && e.outputTokens != null) {
    spend = `, roughly ${formatTokens(e.inputTokens)} input and ${formatTokens(e.outputTokens)} output tokens`;
    if (e.quotaTokens != null) spend += ` (about ${formatTokens(e.quotaTokens)} of subscription quota on ${e.model})`;
    else if (e.costUsd != null) spend += ` (about ${formatUsd(e.costUsd)} at ${e.model}'s list price)`;
  }
  return `${from}${images}${spend}. Audit fix rounds can make it more.`;
}
