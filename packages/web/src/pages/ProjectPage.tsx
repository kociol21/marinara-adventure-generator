import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@adv/shared";
import { api } from "../api.ts";

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const project = useQuery({ queryKey: ["projects", id], queryFn: () => api.get<Project>(`/projects/${id}`) });
  const [title, setTitle] = useState("");

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

  return (
    <section>
      <h1>{project.data.title}</h1>
      <div className="row">
        <input aria-label="Adventure title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <button disabled={!dirty || rename.isPending} onClick={() => rename.mutate(title.trim())}>
          Rename
        </button>
      </div>
      {rename.isError && <p className="error">Rename failed: {rename.error.message}</p>}

      <dl className="facts">
        <dt>Status</dt>
        <dd>{project.data.status}</dd>
        <dt>Created</dt>
        <dd>{new Date(project.data.createdAt).toLocaleString()}</dd>
      </dl>

      <div className="placeholder">
        <h2>Requirements interview</h2>
        <p className="muted">
          The spoiler-free interview arrives in milestone M3. You will describe the idea, answer a few questions about
          preferences, and approve a summary — never the solution.
        </p>
      </div>

      <div className="danger-zone">
        <button
          className="danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete "${project.data.title}" and all its local data? This cannot be undone.`)) {
              remove.mutate();
            }
          }}
        >
          Delete adventure
        </button>
      </div>
    </section>
  );
}
