import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { HealthResponse } from "@adv/shared";
import { api } from "./api.ts";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { ConnectionsPage } from "./pages/ConnectionsPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

export function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<HealthResponse>("/health") });

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Adventure Generator</span>
        <nav>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/connections">Connections</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <span className={`status ${health.isError ? "status-bad" : ""}`}>
          {health.isError ? "Server offline" : health.data ? `v${health.data.version}` : "…"}
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
