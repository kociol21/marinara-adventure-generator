import { AUDIT_AREA_LABELS, type AuditArea, type AuditReportView, type JudgeView } from "@adv/shared";

const num = (x: number) => x.toFixed(2);

/** Decision-model scores: numbers and requirement labels only. */
function JudgeScores({ judge }: { judge: JudgeView }) {
  const passed = judge.parts.filter((p) => p.pass).length;
  return (
    <div className="audit-area judge">
      <strong>Judge scores</strong>{" "}
      <span className="muted small">
        {judge.model} · pass above {num(judge.threshold)} · up to {judge.maxRounds} fix rounds
      </span>
      <p className={passed === judge.parts.length ? "ok small" : "small"}>
        {passed} of {judge.parts.length} parts pass.
      </p>
      {judge.rounds.length > 0 && (
        <table className="judge-table small">
          <thead>
            <tr>
              <th>Round</th>
              <th>Passed</th>
              <th>Lowest</th>
              <th>Mean</th>
            </tr>
          </thead>
          <tbody>
            {judge.rounds.map((r) => (
              <tr key={r.round}>
                <td>{r.round}</td>
                <td>
                  {r.passed}/{r.total}
                </td>
                <td>{num(r.lowest)}</td>
                <td>{num(r.mean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="judge-table small">
        <thead>
          <tr>
            <th>Part</th>
            <th>Score</th>
            <th>Quality</th>
            <th>Lowest requirement</th>
          </tr>
        </thead>
        <tbody>
          {judge.parts.map((p) => {
            const low = [...p.fit].sort((a, b) => a.p - b.p)[0];
            return (
              <tr key={p.where} className={p.pass ? "" : "judge-fail"}>
                <td>
                  {p.where}
                  {p.restored && <span className="muted"> (earlier version kept)</span>}
                </td>
                <td>
                  {p.pass ? "✓" : "✕"} {num(p.score)}
                </td>
                <td>{num(p.quality)}</td>
                <td title={p.fit.map((f) => `${f.label}: ${num(f.p)}`).join("\n")}>{low ? `${low.label} ${num(low.p)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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

      {audit.judge && <JudgeScores judge={audit.judge} />}

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
