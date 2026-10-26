import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@adv/shared";
import { api } from "../api.ts";

export function LibraryPage() {
  const [search, setSearch] = useState("");
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects") });
  const needle = search.trim().toLowerCase();
  const shown = (projects.data ?? []).filter(
    (p) => !needle || [p.name, p.title, p.teaser].some((text) => text?.toLowerCase().includes(needle)),
  );

  return (
    <section>
      <h1>Adventure library</h1>
      {(projects.data?.length ?? 0) > 0 && (
        <input
          type="search"
          className="library-search"
          aria-label="Search adventures"
          placeholder="Search by title or teaser"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {projects.isLoading && <p className="muted">Loading…</p>}
      {projects.isError && <p className="error">Could not load adventures: {projects.error.message}</p>}
      {projects.data?.length === 0 && <p className="muted">No adventures yet. Press New adventure at the top to start one.</p>}
      {needle && projects.data?.length && shown.length === 0 ? <p className="muted">No adventure matches “{search.trim()}”.</p> : null}

      <ul className="cards">
        {shown.map((project) => (
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
