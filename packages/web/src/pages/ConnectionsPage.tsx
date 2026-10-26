import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CONNECTION_KINDS,
  connectionKindSchema,
  TASK_CAPABILITY,
  type CatalogModel,
  type Connection,
  type ConnectionKind,
  type Task,
  type TaskAssignment,
} from "@adv/shared";
import { api } from "../api.ts";
import { ConnectionCard, billingLabel } from "../components/ConnectionCard.tsx";

const TASKS: Array<{ task: Task; label: string; hint: string; empty?: string }> = [
  { task: "text", label: "Text generation", hint: "Interview, facts, cards, lorebooks and audits." },
  {
    task: "story",
    label: "Story model (optional)",
    hint: "A stronger model for the plan, the clues and the opening with its Secret Plot. Everything else stays on the text model.",
    empty: "Same as text generation",
  },
  { task: "image", label: "Avatars", hint: "Character portraits." },
  { task: "embedding", label: "Embeddings (audit)", hint: "Finds facts repeated in other words across the package." },
  {
    task: "decision",
    label: "Judge (decision model)",
    hint: "Scores each part for fit to the requirements and quality; parts below the bar are rewritten.",
  },
];

export function ConnectionsPage() {
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api.get<Connection[]>("/connections") });

  return (
    <section>
      <h1>Connections</h1>
      <p className="muted">
        Each task uses exactly the connection and model you pick below. Nothing switches provider, model or billing on
        its own.
      </p>
      {connections.data && <Assignments connections={connections.data} />}
      <h2>Your connections</h2>
      {connections.isLoading && <p className="muted">Loading…</p>}
      {connections.isError && <p className="error">Could not load connections: {connections.error.message}</p>}
      {connections.data?.length === 0 && <p className="muted">No connections yet. Add one below.</p>}
      {connections.data?.map((c) => <ConnectionCard key={c.id} connection={c} />)}
      <AddConnection />
    </section>
  );
}

function Assignments({ connections }: { connections: Connection[] }) {
  const queryClient = useQueryClient();
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: () => api.get<TaskAssignment[]>("/assignments") });
  const models = useQuery({
    queryKey: ["models", "all", connections.map((c) => c.id).join(",")],
    queryFn: async () => (await Promise.all(connections.map((c) => api.get<CatalogModel[]>(`/connections/${c.id}/models`)))).flat(),
  });

  const save = useMutation({
    mutationFn: ({ task, value }: { task: Task; value: string }) => {
      if (!value) return api.delete(`/assignments/${task}`);
      const [connectionId, ...rest] = value.split("|");
      return api.put(`/assignments/${task}`, { connectionId, modelId: rest.join("|") });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["assignments"] }),
  });

  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? "?";

  return (
    <div className="panel">
      <h2>Task assignments</h2>
      {TASKS.map(({ task, label, hint, empty }) => {
        const current = assignments.data?.find((a) => a.task === task);
        const options = (models.data ?? []).filter((m) => m.capability === TASK_CAPABILITY[task]);
        return (
          <label key={task} className="field">
            <span>
              {label} <small className="muted">{hint}</small>
            </span>
            <select
              value={current ? `${current.connectionId}|${current.modelId}` : ""}
              onChange={(e) => save.mutate({ task, value: e.target.value })}
            >
              <option value="">{empty ?? "Not assigned"}</option>
              {options.map((m) => (
                <option key={`${m.connectionId}|${m.modelId}`} value={`${m.connectionId}|${m.modelId}`}>
                  {nameOf(m.connectionId)} · {m.name} ({billingLabel(m)})
                </option>
              ))}
            </select>
            {options.length === 0 && <small className="muted">Fetch or add a suitable model on a connection first.</small>}
          </label>
        );
      })}
      {save.isError && <p className="error">Could not save the assignment: {save.error.message}</p>}
    </div>
  );
}

function AddConnection() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>("nano-gpt");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const info = CONNECTION_KINDS[kind];

  const create = useMutation({
    mutationFn: () =>
      api.post<Connection>("/connections", {
        kind,
        name: name.trim() || info.label,
        baseUrl: info.baseUrlEditable ? baseUrl.trim() : "",
        ...(info.needsApiKey && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      }),
    onSuccess: () => {
      setName("");
      setBaseUrl("");
      setApiKey("");
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>Add a connection</h2>
      <label className="field">
        <span>Type</span>
        <select value={kind} onChange={(e) => setKind(connectionKindSchema.parse(e.target.value))}>
          {Object.values(CONNECTION_KINDS).map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <small className="muted">{info.notes}</small>
      </label>
      <label className="field">
        <span>Name</span>
        <input value={name} placeholder={info.label} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      {info.baseUrlEditable && (
        <label className="field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            placeholder={info.defaultBaseUrl || "https://example.com/v1"}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}
      {info.needsApiKey && (
        <label className="field">
          <span>API key</span>
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <small className="muted">Stored in the Windows credential store. It is never shown again.</small>
        </label>
      )}
      {kind === "codex-chatgpt" && (
        <p className="muted">
          No key needed. Sign in once with <code>codex login</code> (Codex CLI or app) on this computer.
        </p>
      )}
      <button type="submit" disabled={create.isPending || (kind === "openai-compatible" && !baseUrl.trim())}>
        Add connection
      </button>
      {create.isError && <p className="error">Could not add the connection: {create.error.message}</p>}
    </form>
  );
}
