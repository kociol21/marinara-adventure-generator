import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CONNECTION_KINDS,
  type Capability,
  type CatalogModel,
  type CodexLoginStatus,
  type Connection,
  type FetchModelsResult,
  type ImageTestResult,
  type TextTestResult,
} from "@adv/shared";
import { api } from "../api.ts";
import { askConfirm } from "./ConfirmDialog.tsx";

const CAPABILITIES: Capability[] = ["text", "image", "embedding"];

export function billingLabel(m: Pick<CatalogModel, "billing" | "quotaMultiplier" | "source">): string {
  const base =
    m.billing === "subscription"
      ? m.quotaMultiplier && m.quotaMultiplier !== 1
        ? `subscription ${m.quotaMultiplier}x`
        : "subscription"
      : m.billing === "paid"
        ? "paid"
        : m.billing === "free"
          ? "free"
          : "billing unknown";
  return m.source === "manual" ? `${base}, unconfirmed` : base;
}

export function ConnectionCard({ connection }: { connection: Connection }) {
  const queryClient = useQueryClient();
  const info = CONNECTION_KINDS[connection.kind];
  const [newKey, setNewKey] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["connections"] });
    void queryClient.invalidateQueries({ queryKey: ["models"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments"] });
  };

  const setKey = useMutation({
    mutationFn: () => api.put(`/connections/${connection.id}/api-key`, { apiKey: newKey.trim() }),
    onSuccess: () => {
      setNewKey("");
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/connections/${connection.id}`),
    onSuccess: () => {
      // Take the card off screen and forget its cached lists before refreshing, or the still-mounted
      // queries refetch the deleted connection into 404s.
      const id = connection.id;
      const mentions = (key: readonly unknown[]) => JSON.stringify(key).includes(id);
      queryClient.setQueryData<Connection[]>(["connections"], (old) => old?.filter((c) => c.id !== id));
      queryClient.removeQueries({ predicate: (q) => mentions(q.queryKey) });
      void queryClient.invalidateQueries({
        predicate: (q) => !mentions(q.queryKey) && ["connections", "models", "assignments"].includes(String(q.queryKey[0])),
      });
    },
  });

  return (
    <article className="panel">
      <header className="card-header">
        <div>
          <strong>{connection.name}</strong> <span className="badge">{info.label}</span>
          <div className="muted small">{connection.baseUrl}</div>
        </div>
        <button
          className="danger"
          onClick={() => {
            void askConfirm(`Remove the connection "${connection.name}"? Its stored API key is deleted too.`).then((ok) => ok && remove.mutate());
          }}
        >
          Remove
        </button>
      </header>

      {info.needsApiKey && (
        <div className="row">
          <span className={connection.hasApiKey ? "ok" : "error"}>{connection.hasApiKey ? "API key stored" : "No API key"}</span>
          <input
            type="password"
            autoComplete="off"
            placeholder={connection.hasApiKey ? "Replace API key" : "Paste API key"}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <button disabled={!newKey.trim() || setKey.isPending} onClick={() => setKey.mutate()}>
            Save key
          </button>
        </div>
      )}
      {setKey.isError && <p className="error">{setKey.error.message}</p>}
      {connection.kind === "codex-chatgpt" && <CodexStatus connectionId={connection.id} />}

      {CAPABILITIES.map((capability) => (
        <CapabilitySection key={capability} connection={connection} capability={capability} />
      ))}
    </article>
  );
}

function CodexStatus({ connectionId }: { connectionId: string }) {
  const status = useQuery({
    queryKey: ["codex-status", connectionId],
    queryFn: () => api.get<CodexLoginStatus>(`/connections/${connectionId}/codex-status`),
  });
  if (!status.data) return null;
  const s = status.data;
  return (
    <div className="subpanel">
      <div className="row">
        <span className={s.loggedIn && !s.problem ? "ok" : "error"}>
          {s.loggedIn ? `Signed in${s.planType ? ` (${s.planType} plan)` : ""}` : "Not signed in"}
        </span>
        <button className="secondary" onClick={() => void status.refetch()}>
          Check again
        </button>
      </div>
      {s.problem && <p className="error">{s.problem}</p>}
      <p className="muted small">
        Login file: <code>{s.authFile}</code>
        {s.accessTokenExpiresAt && <> · token valid until {new Date(s.accessTokenExpiresAt).toLocaleString()} (refreshed automatically)</>}
      </p>
      <p className="muted small">
        To sign in again, run <code>codex login</code>. To sign out, run <code>codex logout</code>. This app never deletes
        your Codex login, because other Codex tools use it too.
      </p>
    </div>
  );
}

function CapabilitySection({ connection, capability }: { connection: Connection; capability: Capability }) {
  const queryClient = useQueryClient();
  const support = CONNECTION_KINDS[connection.kind].catalog[capability];
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [manualId, setManualId] = useState("");
  const [result, setResult] = useState<TextTestResult | ImageTestResult | null>(null);

  const models = useQuery({
    queryKey: ["models", connection.id, capability],
    queryFn: () => api.get<CatalogModel[]>(`/connections/${connection.id}/models?capability=${capability}`),
    enabled: support !== "unsupported",
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["models"] });
    void queryClient.invalidateQueries({ queryKey: ["assignments"] });
  };

  const fetchModels = useMutation({
    mutationFn: () => api.post<FetchModelsResult>(`/connections/${connection.id}/models/fetch`, { capability }),
    onSuccess: invalidate,
  });

  const addManual = useMutation({
    mutationFn: () => api.post<CatalogModel>(`/connections/${connection.id}/models`, { capability, modelId: manualId.trim() }),
    onSuccess: (m) => {
      setManualId("");
      setSelected(m.modelId);
      invalidate();
    },
  });

  const test = useMutation({
    mutationFn: (modelId: string) =>
      api.post<TextTestResult | ImageTestResult>(`/connections/${connection.id}/test-${capability}`, { modelId, confirmUsage: true }),
    onMutate: () => setResult(null),
    onSuccess: setResult,
  });

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (models.data ?? []).filter((m) => !q || m.modelId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [models.data, filter]);

  if (support === "unsupported") {
    return (
      <div className="subpanel">
        <h3>{titleOf(capability)}</h3>
        <p className="muted small">Not available on this connection.</p>
      </div>
    );
  }

  const chosen = (models.data ?? []).find((m) => m.modelId === selected);
  const canTest = capability !== "embedding" && !!chosen;

  const runTest = () => {
    if (!chosen) return;
    const what = capability === "image" ? "generate one real image" : "send one short real request";
    const cost =
      chosen.billing === "paid"
        ? "This model bills your paid balance."
        : chosen.billing === "subscription"
          ? "This uses your subscription quota."
          : chosen.billing === "free"
            ? "This model is listed as free."
            : "Billing for this model is unknown; it may cost money.";
    void askConfirm(`Test "${chosen.name}" on ${connection.name}? This will ${what}. ${cost}`).then((ok) => ok && test.mutate(chosen.modelId));
  };

  return (
    <div className="subpanel">
      <h3>{titleOf(capability)}</h3>
      <div className="row">
        {support !== "manual" && (
          <button className="secondary" disabled={fetchModels.isPending} onClick={() => fetchModels.mutate()}>
            {fetchModels.isPending ? "Fetching…" : `Fetch ${capability} models`}
          </button>
        )}
        <input placeholder="Model id (manual, unconfirmed)" value={manualId} onChange={(e) => setManualId(e.target.value)} />
        <button className="secondary" disabled={!manualId.trim() || addManual.isPending} onClick={() => addManual.mutate()}>
          Add
        </button>
      </div>
      {support === "builtin" && <p className="muted small">This provider has no {capability} model list; the known default is offered.</p>}
      {support === "manual" && <p className="muted small">This provider has no {capability} model list. Enter the model id yourself.</p>}
      {fetchModels.isError && <p className="error">{fetchModels.error.message}</p>}
      {fetchModels.isSuccess && <p className="muted small">Fetched {fetchModels.data.models.length} models. Fetching never generates anything.</p>}
      {addManual.isError && <p className="error">{addManual.error.message}</p>}

      {(models.data?.length ?? 0) > 0 && (
        <div className="row">
          {(models.data?.length ?? 0) > 12 && (
            <input className="narrow" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label={`${capability} model`}>
            <option value="">Select a model ({models.data?.length})</option>
            {visible.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.name} — {billingLabel(m)}
              </option>
            ))}
          </select>
          {capability !== "embedding" && (
            <button disabled={!canTest || test.isPending} onClick={runTest}>
              {test.isPending ? "Testing…" : `Test ${capability}`}
            </button>
          )}
        </div>
      )}
      {test.isError && <p className="error">{test.error.message}</p>}
      {result && <TestResultView result={result} />}
    </div>
  );
}

function TestResultView({ result }: { result: TextTestResult | ImageTestResult }) {
  if (!result.ok) return <p className="error">Test failed after {result.latencyMs} ms: {result.error}</p>;
  return (
    <div className="ok small">
      Works · {result.modelId} · {result.latencyMs} ms
      {"reply" in result && result.reply !== undefined && <> · reply: “{result.reply || "(empty)"}”</>}
      {"imageDataUrl" in result && result.imageDataUrl && <img className="test-image" src={result.imageDataUrl} alt="Test result" />}
    </div>
  );
}

const titleOf = (c: Capability) => (c === "text" ? "Text models" : c === "image" ? "Image models" : "Embedding models");
