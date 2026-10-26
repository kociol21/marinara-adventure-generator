import { AUDIT_AREA_LABELS, type AuditArea, type AuditReportView } from "@adv/shared";

/** Spoiler-free audit report. Details appear only when the server sends them (Show spoilers on). */
export function AuditReport({
  audit,
  busy,
  onRerun,
  onRegeneratePlan,
}: {
  audit: AuditReportView;
  busy: boolean;
  onRerun: () => void;
  onRegeneratePlan: () => void;
}) {
  const major = audit.findings.filter((f) => f.severity === "major").length;
  const areas = [...new Set(audit.findings.map((f) => f.area))] as AuditArea[];
  const planLevel = audit.findings.filter((f) => f.severity === "major" && f.fix === "plan").length;
  const autoOpen = audit.findings.filter((f) => f.severity === "major" && f.fix === "auto").length;

  return (
    <div className="audit">
      <h3>Quality report</h3>
      <p className={major ? "error" : "ok"}>
        {audit.findings.length === 0
          ? "No open findings."
          : `${audit.findings.length} open finding${audit.findings.length === 1 ? "" : "s"} (${major} major).`}{" "}
        <span className="muted small">
          Automatic fix rounds: {audit.fixRounds} of {audit.maxFixRounds}.
        </span>
      </p>

      {areas.map((area) => (
        <div key={area} className="audit-area">
          <strong>{AUDIT_AREA_LABELS[area]}</strong>
          <ul>
            {audit.findings
              .filter((f) => f.area === area)
              .map((f) => (
                <li key={f.id}>
                  <span className={`badge badge-${f.severity}`}>{f.severity}</span> {f.summary}
                  {f.source === "model" && <span className="muted small"> (model review)</span>}
                  {f.fix === "plan" && <span className="muted small"> (needs a new plan)</span>}
                  {f.detail && <pre className="small stage-detail">{f.detail}</pre>}
                </li>
              ))}
          </ul>
        </div>
      ))}

      {(autoOpen > 0 || planLevel > 0) && (
        <div className="row">
          {autoOpen > 0 && (
            <button className="secondary" disabled={busy} onClick={onRerun}>
              Run audit and fixes again
            </button>
          )}
          {planLevel > 0 && (
            <button className="secondary" disabled={busy} onClick={onRegeneratePlan}>
              Regenerate the plan
            </button>
          )}
        </div>
      )}
      {planLevel > 0 && (
        <p className="muted small">
          {planLevel === 1 ? "One major finding sits" : `${planLevel} major findings sit`} in the plan or fact registry, which
          automatic fixes do not rewrite. Regenerating the plan rewrites the whole adventure.
        </p>
      )}

      <details>
        <summary className="muted small">What was checked, and what was not</summary>
        <ul className="small">
          {audit.checked.map((c) => (
            <li key={c}>✓ {c}</li>
          ))}
          {audit.notChecked.map((c) => (
            <li key={c} className="muted">
              — {c}
            </li>
          ))}
        </ul>
        <p className="muted small">Model-based checks are heuristic: no findings does not prove there are no contradictions or spoilers.</p>
      </details>
    </div>
  );
}
