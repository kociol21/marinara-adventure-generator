import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogModel, Connection, InterviewState, TaskAssignment } from "@adv/shared";
import { api, ApiRequestError } from "../api.ts";
import { RequirementsSummary } from "./RequirementsSummary.tsx";
import { RequirementsForm } from "./RequirementsForm.tsx";

export function Interview({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const key = ["interview", projectId];
  const state = useQuery({ queryKey: key, queryFn: () => api.get<InterviewState>(`/projects/${projectId}/interview`) });
  const textModel = useTextModel();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);

  const setState = (s: InterviewState) => {
    queryClient.setQueryData(key, s);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const send = useMutation({
    mutationFn: (content: string) => api.post<InterviewState>(`/projects/${projectId}/interview/messages`, { content }),
    onSuccess: (s) => {
      setDraft("");
      setState(s);
    },
    onError: (error) => {
      // A failed model call still stored the player's message; show it.
      const body = error instanceof ApiRequestError ? (error.body as { state?: InterviewState }) : undefined;
      if (body?.state) queryClient.setQueryData(key, body.state);
    },
  });

  const approve = useMutation({
    mutationFn: () => api.post<InterviewState>(`/projects/${projectId}/requirements/approve`, {}),
    onSuccess: setState,
  });

  const save = useMutation({
    mutationFn: (body: { requirements: InterviewState["requirements"]; assumptions: string[] }) =>
      api.put<InterviewState>(`/projects/${projectId}/requirements`, body),
    onSuccess: (s) => {
      setEditing(false);
      setState(s);
    },
  });

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect
  // must return nothing or a cleanup function.
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [state.data?.messages.length]);

  if (state.isLoading) return <p className="muted">Loading…</p>;
  if (!state.data) return <p className="error">Could not load the interview.</p>;
  const s = state.data;
  const started = s.messages.length > 0;
  const approved = !!s.approvedAt;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() && !send.isPending) send.mutate(draft.trim());
  };

  return (
    <div>
      <h2>Requirements interview</h2>
      {!started && (
        <p className="muted">
          Describe your idea in a few sentences, in any language. The interviewer asks only about preferences such as
          genre, tone, setting, cast size and boundaries — never about secrets, culprits or the ending.
        </p>
      )}

      {started && (
        <div className="chat-log">
          {s.messages.map((m) => (
            <div key={m.id} className={`bubble bubble-${m.role}`}>
              <div className="bubble-text">{m.content}</div>
              {m.questions.length > 0 && (
                <ul>
                  {m.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {send.isPending && <div className="bubble bubble-assistant muted">Thinking…</div>}
          <div ref={logEnd} />
        </div>
      )}

      {!approved && (
        <form onSubmit={onSubmit} className="composer">
          <textarea
            aria-label="Your message"
            rows={started ? 3 : 5}
            maxLength={4000}
            placeholder={started ? "Answer, add details, or say you are done." : "Detective noir in an alternate 1940 New York…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit(e);
            }}
          />
          <div className="row">
            <small className="muted composer-note">
              {textModel
                ? `Each message is one request to ${textModel}.`
                : (
                  <>
                    No text model assigned. <Link to="/connections">Assign one in Connections</Link>.
                  </>
                )}
            </small>
            <button type="submit" disabled={!draft.trim() || send.isPending || !textModel}>
              {started ? "Send" : "Start interview"}
            </button>
          </div>
        </form>
      )}
      {send.isError && <p className="error">{send.error.message}</p>}

      {s.version > 0 && (
        <div className="panel">
          <div className="card-header">
            <h2>Summary</h2>
            {approved ? (
              <span className="badge badge-approved">Approved {new Date(s.approvedAt!).toLocaleString()}</span>
            ) : s.readyForSummary ? (
              <span className="badge">Ready to approve</span>
            ) : (
              <span className="badge">Draft</span>
            )}
          </div>
          {editing ? (
            <RequirementsForm
              initial={s.requirements}
              assumptions={s.assumptions}
              saving={save.isPending}
              onCancel={() => setEditing(false)}
              onSave={(requirements, assumptions) => save.mutate({ requirements, assumptions })}
            />
          ) : (
            <RequirementsSummary requirements={s.requirements} assumptions={s.assumptions} missing={s.missing} />
          )}
          {save.isError && <p className="error">{save.error.message}</p>}
          {!editing && (
            <div className="row">
              <button className="secondary" onClick={() => setEditing(true)}>
                {approved ? "Edit (needs approval again)" : "Edit"}
              </button>
              {!approved && (
                <button disabled={s.missing.length > 0 || approve.isPending} onClick={() => approve.mutate()}>
                  Approve requirements
                </button>
              )}
            </div>
          )}
          {approve.isError && <p className="error">{approve.error.message}</p>}
        </div>
      )}
    </div>
  );
}

/** "Connection · model" for the text task, or null when nothing is assigned. */
function useTextModel(): string | null {
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: () => api.get<TaskAssignment[]>("/assignments") });
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api.get<Connection[]>("/connections") });
  const text = assignments.data?.find((a) => a.task === "text");
  const models = useQuery({
    queryKey: ["models", text?.connectionId, "text"],
    queryFn: () => api.get<CatalogModel[]>(`/connections/${text!.connectionId}/models?capability=text`),
    enabled: !!text,
  });
  if (!text) return null;
  const conn = connections.data?.find((c) => c.id === text.connectionId);
  const model = models.data?.find((m) => m.modelId === text.modelId);
  return `${conn?.name ?? "?"} · ${model?.name ?? text.modelId}`;
}
