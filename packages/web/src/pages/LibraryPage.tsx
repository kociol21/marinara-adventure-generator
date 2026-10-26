import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@adv/shared";
import { api } from "../api.ts";

export function LibraryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects") });

  const create = useMutation({
    mutationFn: (newTitle: string) => api.post<Project>("/projects", { title: newTitle }),
    onSuccess: (project) => {
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim()) create.mutate(title.trim());
  };

  return (
    <section>
      <h1>Adventure library</h1>
      <form className="row" onSubmit={onSubmit}>
        <input
          aria-label="New adventure title"
          placeholder="Working title, e.g. Noir in 1940 New York"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" disabled={!title.trim() || create.isPending}>
          New adventure
        </button>
      </form>
      {create.isError && <p className="error">Could not create the adventure: {create.error.message}</p>}

      {projects.isLoading && <p className="muted">Loading…</p>}
      {projects.isError && <p className="error">Could not load adventures: {projects.error.message}</p>}
      {projects.data?.length === 0 && <p className="muted">No adventures yet. Start one above.</p>}

      <ul className="cards">
        {projects.data?.map((project) => (
          <li key={project.id} className="card">
            <Link to={`/projects/${project.id}`}>
              <strong>{project.name || project.title}</strong>
            </Link>
            <span className={`badge badge-${project.status}`}>{project.status}</span>
            <p className="muted">{project.teaser || "No teaser yet."}</p>
            <small className="muted">Updated {new Date(project.updatedAt).toLocaleString()}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
