import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HealthResponse, Settings, UpdateSettingsInput } from "@adv/shared";
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

      <h2>Storage</h2>
      <dl className="facts">
        <dt>Data folder</dt>
        <dd>{health.data?.dataDir ?? "…"}</dd>
        <dt>Secret storage</dt>
        <dd>{health.data?.secretStore === "os-keyring" ? "Operating system credential store" : (health.data?.secretStore ?? "…")}</dd>
      </dl>
    </section>
  );
}
