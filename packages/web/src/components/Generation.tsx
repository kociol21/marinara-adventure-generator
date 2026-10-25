import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenerationState, StageView } from "@adv/shared";
import { api } from "../api.ts";

const ICON: Record<StageView["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  stale: "◌",
};

export function Generation({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const key = ["generation", projectId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => api.get<GenerationState>(`/projects/${projectId}/generation`),
    // Poll while a job runs; stop when it ends.
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });

  const after = (s: GenerationState) => {
    queryClient.setQueryData(key, s);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
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

  // A finished run changes the project (status, teaser); refresh it when running turns off.
  const running = state.data?.running ?? false;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void queryClient.invalidateQueries({ queryKey: ["projects"] });
    wasRunning.current = running;
  }, [running, queryClient]);

  if (!state.data) return null;
  const s = state.data;
  const started = s.stages.some((st) => st.status !== "pending");
  const failed = s.stages.find((st) => st.status === "failed");

  const confirmRun = (what: string, run: () => void) => {
    if (window.confirm(`${what} Each stage is one or more requests to your Text generation model and uses quota or credits.`)) run();
  };

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
          <button onClick={() => confirmRun(started ? "Resume generation?" : "Start generating the adventure?", () => start.mutate())}>
            {failed ? "Retry from the failed stage" : started ? "Resume" : "Generate adventure"}
          </button>
        ) : (
          <a className="button" href={`/api/projects/${projectId}/export`} download>
            Download for Marinara (.zip)
          </a>
        )}
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
