import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MarinaraStatus, PushRecord, PushRequest, PushStep } from "@adv/shared";
import { api } from "../api.ts";
import { MarinaraStatusLine } from "../pages/SettingsPage.tsx";

const STEP_ICON: Record<PushStep["status"], string> = { ok: "●", skipped: "○", failed: "✕", undone: "↺" };

/** Push to Marinara: creates the adventure and a ready chat in the user's Marinara (architecture plan §6). */
export function PushPanel({ projectId, vectorBooks }: { projectId: string; vectorBooks: number }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["marinara-status"],
    queryFn: () => api.get<MarinaraStatus>("/marinara/status"),
    staleTime: 60_000,
  });
  const history = useQuery({ queryKey: ["pushes", projectId], queryFn: () => api.get<PushRecord[]>(`/projects/${projectId}/marinara/pushes`) });
  const [vectorConnectionId, setVectorConnectionId] = useState("");
  // Null until the user picks: then Marinara's own defaults are preselected.
  const [connectionPick, setConnectionPick] = useState<string | null>(null);
  const [presetPick, setPresetPick] = useState<string | null>(null);

  const push = useMutation({
    mutationFn: (body: PushRequest) => api.post<PushRecord>(`/projects/${projectId}/marinara/push`, body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["pushes", projectId] }),
  });

  const st = status.data;
  const last = push.data ?? history.data?.[0] ?? null;
  const earlier = (history.data ?? []).filter((r) => r.status === "done").length;
  const ready = !!st?.reachable && !!st.authenticated;
  const known = (id: string | null, list: Array<{ id: string }>) => (id !== null && (id === "" || list.some((x) => x.id === id)) ? id : null);
  const connectionId = known(connectionPick, st?.chatConnections ?? []) ?? st?.chatConnections.find((c) => c.isDefault)?.id ?? "";
  const presetId = known(presetPick, st?.presets ?? []) ?? st?.presets.find((p) => p.isDefault)?.id ?? "";

  const run = () => {
    const withoutSecretPlot = st?.directorInstalled !== true;
    const lines = [
      `Push this adventure to ${st?.baseUrl}?`,
      "",
      "It creates new characters, persona, lorebooks and a roleplay chat there; nothing existing is changed.",
      withoutSecretPlot
        ? "The Narrative Director is not installed, so the chat will have no seeded Secret Plot."
        : "The Narrative Director's Secret Plot is seeded for the new chat.",
      ...(connectionId ? [] : ["No connection is set for the chat; pick one in Marinara's chat settings before the first message."]),
      ...(vectorConnectionId ? ["Vectorizing uses that Marinara connection's embedding model (quota or credits)."] : []),
      ...(earlier ? [`This adventure was pushed ${earlier} time(s) before; this creates another copy.`] : []),
    ];
    if (window.confirm(lines.join("\n"))) push.mutate({
        confirm: true,
        withoutSecretPlot,
        vectorConnectionId: vectorConnectionId || null,
        connectionId: connectionId || null,
        promptPresetId: presetId || null,
      });
  };

  return (
    <div className="subpanel push">
      <h3>Push to Marinara</h3>
      <p className="muted small">
        Sets the adventure up in Marinara for you: imports, a roleplay chat with the lorebooks attached, the opening scene and the
        Narrative Director's Secret Plot, which file import cannot carry. You never see the plot.
      </p>
      {status.isLoading && <p className="muted small">Checking Marinara…</p>}
      {st && !st.baseUrl && (
        <p className="small">
          Set the Marinara URL (and login, if it asks for one) in <Link to="/settings">Settings</Link>.
        </p>
      )}
      {st?.baseUrl && <MarinaraStatusLine status={st} />}

      {ready && (
        <>
          <label className="field">
            <span>Chat connection</span>
            <select value={connectionId} onChange={(e) => setConnectionPick(e.target.value)}>
              <option value="">None — choose in Marinara later</option>
              {st.chatConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.model ? ` (${c.model})` : ""}
                  {c.isDefault ? " — default" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Prompt preset</span>
            <select value={presetId} onChange={(e) => setPresetPick(e.target.value)}>
              <option value="">None</option>
              {st.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? " — default" : ""}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {ready && vectorBooks > 0 && (
        <label className="field">
          <span>Build vectors for {vectorBooks === 1 ? "1 lorebook" : `${vectorBooks} lorebooks`} with</span>
          <select value={vectorConnectionId} onChange={(e) => setVectorConnectionId(e.target.value)}>
            <option value="">Do not vectorize now (keywords still work)</option>
            {st.embeddingConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.embeddingModel})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="row">
        <button disabled={!ready || push.isPending} onClick={run}>
          {push.isPending ? "Pushing…" : "Push to Marinara"}
        </button>
        <button className="secondary" disabled={status.isFetching} onClick={() => void status.refetch()}>
          Check again
        </button>
      </div>
      {push.isError && <p className="error">{push.error.message}</p>}

      {last && (
        <div className="push-result">
          <p className="small">
            <strong>
              {last.status === "done"
                ? "Pushed"
                : last.steps.some((s) => s.id === "rollback" && s.status === "ok")
                  ? "Push failed, nothing left behind"
                  : "Push failed"}
            </strong>{" "}
            {new Date(last.pushedAt).toLocaleString()} to {last.baseUrl}
            {last.status === "done" && last.chatName ? (
              <>
                . Open the chat <strong>{last.chatName}</strong> in Marinara and start playing.
              </>
            ) : (
              "."
            )}
          </p>
          <ol className="stages">
            {last.steps.map((s, i) => (
              <li key={i} className={`stage stage-${s.status === "ok" ? "done" : s.status === "failed" ? "failed" : "pending"}`}>
                <span className="stage-icon" aria-hidden>
                  {STEP_ICON[s.status]}
                </span>
                <span>{s.label}</span>
                <span className="muted small">{s.detail}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
