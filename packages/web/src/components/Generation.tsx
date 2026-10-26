import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenerationState, StageView, UsageEstimate } from "@adv/shared";
import { api } from "../api.ts";
import { AuditReport } from "./AuditReport.tsx";
import { ExportPanel } from "./ExportPanel.tsx";
import { Portraits } from "./Portraits.tsx";
import { askConfirm } from "./ConfirmDialog.tsx";
import { UsagePanel, estimateText } from "./Usage.tsx";

const ICON: Record<StageView["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  stale: "◌",
};

/** One adventure step tab: generation progress, quality report, portraits or export (they share one state query). */
export type GenerationView = "generation" | "audit" | "portraits" | "export";

export function Generation({ projectId, view = "generation" }: { projectId: string; view?: GenerationView }) {
  const queryClient = useQueryClient();
  const key = ["generation", projectId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => api.get<GenerationState>(`/projects/${projectId}/generation`),
    // Poll while a job runs; stop when it ends.
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });
  const estimate = useQuery({
    queryKey: ["usage-estimate", projectId],
    queryFn: () => api.get<UsageEstimate>(`/usage/estimate?exclude=${encodeURIComponent(projectId)}`),
    enabled: view === "generation",
  });

  const after = (s: GenerationState) => {
    queryClient.setQueryData(key, s);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["usage", projectId] });
  };

  const start = useMutation({
    mutationFn: () => api.post<GenerationState>(`/projects/${projectId}/generation/start`, { confirmUsage: true }),
    onSuccess: after,
  });
  const cancel = useMutation({
    mutationFn: () => api.post<GenerationState>(`/projects/${projectId}/generation/cancel`, {}),
    onSuccess: after,
  });
  const retry = useMutation({
    mutationFn: (stage: string) =>
      api.post<GenerationState>(`/projects/${projectId}/generation/stages/${encodeURIComponent(stage)}/retry`, { confirmUsage: true }),
    onSuccess: after,
  });

  const rerunAudit = useMutation({
    mutationFn: () => api.post<GenerationState>(`/projects/${projectId}/generation/audit/rerun`, { confirmUsage: true }),
    onSuccess: after,
  });

  // A finished run changes the project (status, teaser); refresh it when running turns off.
  const running = state.data?.running ?? false;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["usage", projectId] });
    }
    wasRunning.current = running;
  }, [running, queryClient, projectId]);

  if (!state.data) return null;
  const s = state.data;
  const started = s.stages.some((st) => st.status !== "pending");
  const failed = s.stages.find((st) => st.status === "failed");

  const confirmRun = (what: string, run: () => void, forecast?: string | null) => {
    void askConfirm(
      `${what} ${forecast ? `${forecast} ` : ""}Each stage is one or more requests to your Text generation model and uses quota or credits. The quality audit adds two requests per round and may regenerate parts with major findings, up to the automatic fix limit in Settings. With a decision model assigned, it also scores every part once per round and may ask for more rounds, up to the judge's limit.`,
    ).then((ok) => ok && run());
  };

  if (view === "portraits") {
    return (
      <div className="panel">
        <Portraits projectId={projectId} running={s.running} />
      </div>
    );
  }

  if (view === "audit") {
    return (
      <div className="panel">
        {s.audit && !s.running ? (
          <AuditReport
            audit={s.audit}
            busy={rerunAudit.isPending || retry.isPending}
            onRerun={() => confirmRun("Run the quality audit again with a new set of automatic fix rounds?", () => rerunAudit.mutate())}
            onRegeneratePlan={() =>
              confirmRun(
                "Regenerate the plan? This rewrites the whole adventure: plan, facts, clues, cards, persona, lorebooks and opening.",
                () => retry.mutate("plan"),
              )
            }
          />
        ) : (
          <p className="muted small">{s.running ? "The quality report appears when generation finishes." : "No quality report yet. It is made at the end of generation."}</p>
        )}
        {rerunAudit.isError && <p className="error">{rerunAudit.error.message}</p>}
        {retry.isError && <p className="error">{retry.error.message}</p>}
      </div>
    );
  }

  if (view === "export") {
    return (
      <div className="panel">
        {s.ready && !s.running ? (
          <>
            {s.title && (
              <div className="subpanel">
                <h3>Title</h3>
                <p>
                  <strong>{s.title}</strong>
                </p>
                <p className="muted small">Used for the export files, the Marinara chat, its folders and the lorebook names.</p>
                <button
                  className="secondary"
                  disabled={retry.isPending}
                  onClick={() =>
                    void askConfirm(
                      "Write a new title? This is one short request to your Text generation model (quota or credits). The current title will not be offered again.",
                    ).then((ok) => ok && retry.mutate("title"))
                  }
                >
                  New title
                </button>
                {retry.isError && <p className="error">{retry.error.message}</p>}
              </div>
            )}
            <ExportPanel projectId={projectId} stamp={s.stages.map((st) => `${st.id}:${st.finishedAt}`).join("|")} />
          </>
        ) : (
          <p className="muted small">Export and Push to Marinara open once generation is finished.</p>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="card-header">
        <h2>Generation</h2>
        {s.running ? <span className="badge">Running…</span> : s.ready ? <span className="badge badge-approved">Ready</span> : null}
      </div>
      <p className="muted small">
        The adventure is written behind the scenes. You see only progress and counts, never the story itself.
      </p>

      <ol className="stages">
        {s.stages.map((st) => (
          <li key={st.id} className={`stage stage-${st.status}`}>
            <span className="stage-icon" aria-hidden>
              {ICON[st.status]}
            </span>
            <span className="stage-label">{st.label}</span>
            <span className="muted small">
              {st.status === "done" && st.summary}
              {st.status === "done" && st.calls > 1 && ` · ${st.calls} requests (${st.calls - 1} ${st.calls === 2 ? "fix" : "fixes"})`}
              {st.status === "stale" && "out of date, will be regenerated"}
              {st.status === "running" && "working…"}
            </span>
            {!s.running && (st.status === "done" || st.status === "failed") && st.id !== "assemble" && (
              <button className="secondary small-button" onClick={() => confirmRun(`Regenerate "${st.label}" and what depends on it?`, () => retry.mutate(st.id))}>
                Regenerate
              </button>
            )}
            {st.error && <div className="error small stage-error">{st.error}</div>}
            {st.errorDetail && <pre className="small stage-detail">{st.errorDetail}</pre>}
          </li>
        ))}
        {!s.stages.some((st) => st.id === "assemble") && (
          <li className="stage muted small">Card, lorebook and opening stages appear once the plan exists.</li>
        )}
      </ol>

      <div className="row">
        {s.running ? (
          <button className="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Stop after this stage
          </button>
        ) : !s.ready ? (
          <button
            onClick={() =>
              confirmRun(started ? "Resume generation?" : "Start generating the adventure?", () => start.mutate(), started ? null : estimateText(estimate.data))
            }
          >
            {failed ? "Retry from the failed stage" : started ? "Resume" : "Generate adventure"}
          </button>
        ) : null}
      </div>
      {(start.isError || retry.isError) && <p className="error">{(start.error ?? retry.error)?.message}</p>}

      {s.ready && s.warnings.length > 0 && (
        <div className="assumptions">
          <strong>Warnings</strong>
          <ul>
            {s.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <UsagePanel projectId={projectId} running={s.running} />

      {s.ready && s.notes.length > 0 && (
        <div className="muted small">
          <strong>Notes</strong>
          <ul>
            {s.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
