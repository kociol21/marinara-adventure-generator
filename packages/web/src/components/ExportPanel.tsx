import { useQuery } from "@tanstack/react-query";
import type { ExportSummary } from "@adv/shared";
import { api } from "../api.ts";
import { PushPanel } from "./PushPanel.tsx";

const CHECK_LABEL = { match: "matches its description", mismatch: "may not match its description", unchecked: "not checked" } as const;

/** What the zip holds and what it cannot do, shown before download (spec §18: limits stated openly). */
export function ExportPanel({ projectId, stamp }: { projectId: string; stamp: string }) {
  const summary = useQuery({
    // The stamp changes whenever the generation state does, so the summary never lags behind it.
    queryKey: ["export-summary", projectId, stamp],
    queryFn: () => api.get<ExportSummary>(`/projects/${projectId}/export/summary`),
  });

  if (summary.isError) {
    return (
      <div className="subpanel">
        <h3>Export</h3>
        <p className="error">{summary.error.message}</p>
      </div>
    );
  }
  if (!summary.data) return null;
  const { manifest: m, notes } = summary.data;
  const vectorBooks = m.vectors.filter((v) => v.configured);
  const portraits = m.portraits.filter((p) => p.included);

  return (
    <div className="subpanel export">
      <h3>Export</h3>
      <dl className="facts">
        <dt>Characters</dt>
        <dd>
          {m.counts.characters} {m.counts.characters === 1 ? "card" : "cards"}
          {m.counts.personas ? ", 1 persona" : ""}
        </dd>
        <dt>Lorebooks</dt>
        <dd>
          {m.counts.lorebooks} with {m.counts.lorebookEntries} entries
        </dd>
        <dt>Portraits</dt>
        <dd>
          {portraits.length === 0
            ? "none"
            : portraits.map((p) => `${p.name}: ${p.check ? CHECK_LABEL[p.check] : "included"}`).join("; ")}
        </dd>
        <dt>Semantic search</dt>
        <dd>
          {vectorBooks.length === 0
            ? "off (keyword matching only)"
            : `configured in ${vectorBooks.length} ${vectorBooks.length === 1 ? "lorebook" : "lorebooks"}; vectors are built in Marinara after import, not verified in play`}
        </dd>
        <dt>Quality audit</dt>
        <dd>
          {m.audit.ran
            ? `${m.audit.openFindings} open ${m.audit.openFindings === 1 ? "finding" : "findings"} (${m.audit.major} major), ${m.audit.fixRounds} of ${m.audit.maxFixRounds} fix rounds used`
            : "not run"}
        </dd>
        <dt>Files</dt>
        <dd>
          {m.files.length + 1}: the import files plus{" "}
          {[...m.files.filter((f) => f.kind === "guide").map((f) => f.path), "manifest.json"].join(", ")}
        </dd>
      </dl>
      <div className="assumptions">
        <strong>Not in the files</strong>
        <ul>
          {m.notIncluded.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      {notes.length > 0 && (
        <details className="small">
          <summary>{notes.length} validation {notes.length === 1 ? "note" : "notes"}</summary>
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        <a className="button" href={`/api/projects/${projectId}/export`} download>
          Download for Marinara (.zip)
        </a>
      </div>
      <PushPanel projectId={projectId} vectorBooks={vectorBooks.length} />
    </div>
  );
}
