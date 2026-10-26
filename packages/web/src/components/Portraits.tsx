import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTRAIT_STYLES, portraitStyleSchema, type PortraitSettings } from "@adv/shared";
import { api } from "../api.ts";

interface PortraitsState {
  settings: PortraitSettings;
  imageModel: string | null;
  portraits: Array<{ stage: string; check: "match" | "mismatch" | "unchecked" }>;
}

const CHECK_LABEL = { match: "matches description", mismatch: "may not match", unchecked: "not checked" } as const;

/** Portrait style and on/off for this adventure. Changing them re-renders only the portraits. */
export function Portraits({ projectId, running }: { projectId: string; running: boolean }) {
  const queryClient = useQueryClient();
  const key = ["portraits", projectId];
  const state = useQuery({ queryKey: key, queryFn: () => api.get<PortraitsState>(`/projects/${projectId}/portraits`), refetchInterval: running ? 3000 : false });
  const [draft, setDraft] = useState<PortraitSettings | null>(null);

  useEffect(() => {
    if (state.data && !draft) setDraft(state.data.settings);
  }, [state.data, draft]);

  const save = useMutation({
    mutationFn: (settings: PortraitSettings) => api.put<{ settings: PortraitSettings }>(`/projects/${projectId}/portraits`, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["generation", projectId] });
    },
  });

  if (!state.data || !draft) return null;
  const s = state.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.settings);
  // Cache-bust per render of a finished run so a regenerated portrait shows up.
  const stamp = s.portraits.map((p) => p.check).join("");

  return (
    <div className="subpanel portraits">
      <h3>Portraits</h3>
      {!s.imageModel ? (
        <p className="muted small">
          No image model assigned, so portraits are skipped. <Link to="/connections">Assign one in Connections</Link>.
        </p>
      ) : (
        <p className="muted small">Image model: {s.imageModel}. Each portrait is one image request, plus a check by the text model.</p>
      )}
      <label className="field checkbox">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        <span>Generate portraits for the cards and the persona</span>
      </label>
      <div className="row">
        <label className="field">
          <span>Style</span>
          <select value={draft.style} onChange={(e) => setDraft({ ...draft, style: portraitStyleSchema.parse(e.target.value) })}>
            {portraitStyleSchema.options.map((style) => (
              <option key={style} value={style}>
                {PORTRAIT_STYLES[style].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Extra direction (optional)</span>
          <input
            placeholder="e.g. muted colours, rain on the window"
            maxLength={500}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
      </div>
      <div className="row">
        <button disabled={!dirty || save.isPending || running} onClick={() => save.mutate(draft)}>
          Save portrait settings
        </button>
        {dirty && <span className="muted small">After saving, Resume generation to render portraits in the new style. Nothing else is regenerated.</span>}
      </div>
      {save.isError && <p className="error">{save.error.message}</p>}

      {s.portraits.length > 0 && (
        <div className="portrait-grid">
          {s.portraits.map((p) => (
            <figure key={p.stage}>
              <img src={`/api/projects/${projectId}/portraits/${encodeURIComponent(p.stage)}/image?v=${stamp}`} alt={p.stage.slice(7)} />
              <figcaption className={`small ${p.check === "mismatch" ? "error" : "muted"}`}>{CHECK_LABEL[p.check]}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
