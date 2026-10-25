import { AUDIT_AREA_LABELS, type AuditArea, type AuditReportView } from "@adv/shared";

/** Spoiler-free audit report. Details appear only when the server sends them (Show spoilers on). */
export function AuditReport({ audit }: { audit: AuditReportView }) {
  const major = audit.findings.filter((f) => f.severity === "major").length;
  const areas = [...new Set(audit.findings.map((f) => f.area))] as AuditArea[];

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
                  {f.detail && <pre className="small stage-detail">{f.detail}</pre>}
                </li>
              ))}
          </ul>
        </div>
      ))}

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
