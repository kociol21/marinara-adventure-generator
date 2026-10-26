import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenerationState, Project } from "@adv/shared";
import { api } from "../api.ts";
import { Interview } from "../components/Interview.tsx";
import { Generation, type GenerationView } from "../components/Generation.tsx";
import { askConfirm } from "../components/ConfirmDialog.tsx";

type Tab = "interview" | GenerationView;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "interview", label: "Interview" },
  { id: "generation", label: "Generation" },
  { id: "audit", label: "Quality" },
  { id: "portraits", label: "Portraits" },
  { id: "export", label: "Export" },
];

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const project = useQuery({ queryKey: ["projects", id], queryFn: () => api.get<Project>(`/projects/${id}`) });
  const [title, setTitle] = useState("");
  const [search, setSearch] = useSearchParams();
  const status = project.data?.status;
  const approved = !!status && status !== "draft" && status !== "interview";
  // Same query as the Generation tabs (shared cache): drives which steps are open and their marks.
  const generation = useQuery({
    queryKey: ["generation", id],
    queryFn: () => api.get<GenerationState>(`/projects/${id}/generation`),
    enabled: approved,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });

  useEffect(() => {
    if (project.data) setTitle(project.data.title);
  }, [project.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });

  const rename = useMutation({
    mutationFn: (newTitle: string) => api.patch<Project>(`/projects/${id}`, { title: newTitle }),
    onSuccess: () => void refresh(),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${id}`),
    onSuccess: () => {
      void refresh();
      navigate("/library");
    },
  });

  if (project.isLoading) return <p className="muted">Loading…</p>;
  if (project.isError || !project.data) return <p className="error">Adventure not found.</p>;

  const dirty = title.trim() !== project.data.title && title.trim().length > 0;

  const g = generation.data;
  const ready = !!g?.ready && !g.running;
  const open: Record<Tab, boolean> = { interview: true, generation: approved, audit: !!g?.audit, portraits: ready, export: ready };
  const mark: Record<Tab, string> = {
    interview: approved ? "✓" : "",
    generation: g?.running ? "◐" : g?.ready ? "✓" : g?.stages.some((st) => st.status === "failed") ? "✕" : "",
    audit: g?.audit ? "✓" : "",
    portraits: "",
    export: status === "exported" ? "✓" : "",
  };
  const fallback: Tab = !approved ? "interview" : ready ? "export" : "generation";
  const asked = search.get("step") as Tab | null;
  const tab: Tab = asked && TABS.some((t) => t.id === asked) && open[asked] ? asked : fallback;
  const go = (next: Tab) => setSearch(next === fallback ? {} : { step: next }, { replace: true });
  const index = TABS.findIndex((t) => t.id === tab);
  const next = TABS.slice(index + 1).find((t) => open[t.id]);

  return (
    <section>
      <header className="project-head">
        <div>
          <h1>{project.data.name || project.data.title}</h1>
          <p className="muted small">Created {new Date(project.data.createdAt).toLocaleString()}</p>
        </div>
        <span className={`badge badge-${project.data.status}`}>{project.data.status}</span>
      </header>

      {project.data.teaser && <p className="teaser">{project.data.teaser}</p>}

      <div className="row title-row">
        <input aria-label="Working title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <button disabled={!dirty || rename.isPending} onClick={() => rename.mutate(title.trim())}>
          Rename
        </button>
      </div>
      {rename.isError && <p className="error">Rename failed: {rename.error.message}</p>}
      {project.data.name && (
        <p className="muted small">
          Working title. The adventure itself is called “{project.data.name}”; get a new one on the Export tab. Renaming the
          working title makes the generated adventure out of date.
        </p>
      )}

      <nav className="steps" role="tablist" aria-label="Adventure steps">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`step-tab${tab === t.id ? " active" : ""}`}
            disabled={!open[t.id]}
            onClick={() => go(t.id)}
          >
            <span className="step-number">{i + 1}</span> {t.label}
            {mark[t.id] && <span className="step-mark">{mark[t.id]}</span>}
          </button>
        ))}
      </nav>

      {tab === "interview" ? <Interview projectId={id} /> : <Generation projectId={id} view={tab} />}

      {next && (
        <div className="row step-next">
          <button className="secondary" onClick={() => go(next.id)}>
            Next: {next.label} →
          </button>
        </div>
      )}

      <div className="danger-zone">
        <button
          className="danger"
          disabled={remove.isPending}
          onClick={() => {
            void askConfirm(`Delete "${project.data.title}" and all its local data? This cannot be undone.`).then((ok) => ok && remove.mutate());
          }}
        >
          Delete adventure
        </button>
      </div>
    </section>
  );
}
