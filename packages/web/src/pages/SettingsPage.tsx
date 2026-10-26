import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MARINARA_PASSWORD_SECRET,
  MARINARA_USER_SECRET,
  type HealthResponse,
  type MarinaraStatus,
  type SecretInfo,
  type Settings,
  type UpdateSettingsInput,
} from "@adv/shared";
import { api } from "../api.ts";
import { useEffect, useState } from "react";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<HealthResponse>("/health") });
  const [marinaraUrl, setMarinaraUrl] = useState<string | null>(null);

  // Seed the draft once; later saves of other settings must not wipe what the user is typing.
  useEffect(() => {
    if (settings.data && marinaraUrl === null) setMarinaraUrl(settings.data.marinaraBaseUrl);
  }, [settings.data, marinaraUrl]);

  const update = useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.patch<Settings>("/settings", input),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });

  if (settings.isLoading) return <p className="muted">Loading…</p>;
  if (settings.isError || !settings.data) return <p className="error">Could not load settings.</p>;
  const s = settings.data;

  return (
    <section>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Generation</h2>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={s.showSpoilers}
            onChange={(e) => update.mutate({ showSpoilers: e.target.checked })}
          />
          <span>
            Show spoilers
            <small className="muted">Reveals hidden adventure content in the app. Off by default.</small>
          </span>
        </label>

        <label className="field">
          <span>Automatic fix attempts per stage</span>
          <select
            value={s.maxAutoFixAttempts}
            onChange={(e) => update.mutate({ maxAutoFixAttempts: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel">
        <h2>Judge</h2>
        <label className="field">
          <span>Judge: pass mark (decision model, 0 to 1)</span>
          <select value={s.judgeThreshold} onChange={(e) => update.mutate({ judgeThreshold: Number(e.target.value) })}>
            {[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map((n) => (
              <option key={n} value={n}>
                above {n.toFixed(2)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Judge: fix rounds at most</span>
          <select value={s.judgeMaxRounds} onChange={(e) => update.mutate({ judgeMaxRounds: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Used only when a decision model is assigned on the Connections page. Each round rewrites the parts below the mark and
          scores them again; it stops early when a round brings no improvement, and keeps an earlier version if a rewrite scores worse.
        </p>
      </div>

      <div className="panel">
        <h2>Marinara</h2>
        <label className="field">
          <span>Marinara URL (for Push to Marinara)</span>
          <div className="row">
            <input
              placeholder="https://your-marinara-host"
              value={marinaraUrl ?? ""}
              onChange={(e) => setMarinaraUrl(e.target.value)}
            />
            <button
              disabled={(marinaraUrl ?? "") === s.marinaraBaseUrl || update.isPending}
              onClick={() => update.mutate({ marinaraBaseUrl: (marinaraUrl ?? "").trim() })}
            >
              Save
            </button>
          </div>
        </label>
        {update.isError && <p className="error">Could not save: {update.error.message}</p>}

        <MarinaraLogin />
      </div>

      <div className="panel">
        <h2>Storage</h2>
        <dl className="facts">
          <dt>Data folder</dt>
          <dd>{health.data?.dataDir ?? "…"}</dd>
          <dt>Secret storage</dt>
          <dd>{health.data?.secretStore === "os-keyring" ? "Operating system credential store" : (health.data?.secretStore ?? "…")}</dd>
        </dl>
      </div>
    </section>
  );
}

/** Marinara's HTTP Basic login (BASIC_AUTH_USER / BASIC_AUTH_PASS). Write-only: stored in the OS credential store. */
function MarinaraLogin() {
  const queryClient = useQueryClient();
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => api.get<SecretInfo[]>("/secrets") });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const saved = (secrets.data ?? []).some((s) => s.name === MARINARA_USER_SECRET) && (secrets.data ?? []).some((s) => s.name === MARINARA_PASSWORD_SECRET);

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/secrets/${MARINARA_USER_SECRET}`, { value: username.trim() });
      await api.put(`/secrets/${MARINARA_PASSWORD_SECRET}`, { value: password });
    },
    onSuccess: () => {
      setUsername("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
      void queryClient.removeQueries({ queryKey: ["marinara-status"] });
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/secrets/${MARINARA_USER_SECRET}`).catch(() => undefined);
      await api.delete(`/secrets/${MARINARA_PASSWORD_SECRET}`).catch(() => undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
      void queryClient.removeQueries({ queryKey: ["marinara-status"] });
    },
  });
  const check = useMutation({ mutationFn: () => api.get<MarinaraStatus>("/marinara/status") });
  const st = check.data;

  return (
    <div className="field">
      <span>Marinara login</span>
      <small className="muted">
        Only if your Marinara asks for a username and password (BASIC_AUTH_USER / BASIC_AUTH_PASS). Stored in the operating system
        credential store, never shown again. {saved ? "A login is saved." : "No login saved."}
      </small>
      <div className="row">
        <input placeholder="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={!username.trim() || !password || save.isPending} onClick={() => save.mutate()}>
          Save login
        </button>
        {saved && (
          <button className="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Forget
          </button>
        )}
      </div>
      <div className="row">
        <button className="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Check Marinara connection"}
        </button>
      </div>
      {save.isError && <p className="error">{save.error.message}</p>}
      {check.isError && <p className="error">{check.error.message}</p>}
      {st && <MarinaraStatusLine status={st} />}
    </div>
  );
}

export function MarinaraStatusLine({ status: st }: { status: MarinaraStatus }) {
  if (!st.reachable || !st.authenticated) return <p className="error small">{st.error ?? "Marinara could not be reached."}</p>;
  return (
    <p className="small">
      <span className="ok">Connected</span> to Marinara {st.version ?? ""}. Narrative Director:{" "}
      {st.directorInstalled ? "installed" : "not installed (Secret Plot cannot be seeded)"}. Embedding connections:{" "}
      {st.embeddingConnections.length || "none"}.
    </p>
  );
}
