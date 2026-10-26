import { useEffect, useRef, useState } from "react";

/**
 * In-page replacement for window.confirm, which some embedded browsers suppress (it then returns
 * false and the action silently never happens). Mount <ConfirmHost /> once; call askConfirm anywhere.
 */
interface Pending {
  message: string;
  /** Ask for an optional change request as well; lists the earlier ones. */
  note?: { earlier: string[] };
  resolve: (answer: { ok: boolean; note: string }) => void;
}

let show: ((pending: Pending) => void) | null = null;

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ message, resolve: (a) => resolve(a.ok) });
    else resolve(window.confirm(message));
  });
}

/** Confirm with an optional change request. Resolves to null when cancelled, else the trimmed note ("" for none). */
export function askConfirmWithNote(message: string, earlier: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    if (show) show({ message, note: { earlier }, resolve: (a) => resolve(a.ok ? a.note.trim() : null) });
    else resolve(window.confirm(message) ? "" : null);
  });
}

export const MAX_NOTE = 1000;

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    show = (next) =>
      setPending((current) => {
        current?.resolve({ ok: false, note: "" });
        setNote("");
        return next;
      });
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve({ ok, note });
    setPending(null);
    setNote("");
    dialog.current?.close();
  };

  return (
    <dialog ref={dialog} className="confirm-dialog" onCancel={() => close(false)}>
      {pending && (
        <>
          {pending.message.split("\n").map((line, i) => (line ? <p key={i}>{line}</p> : null))}
          {pending.note && (
            <div className="note-field">
              {pending.note.earlier.length > 0 && (
                <div className="small">
                  <strong>Your earlier requests</strong> (still applied)
                  <ul>
                    {pending.note.earlier.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="field">
                <span>Change request (optional)</span>
                <textarea
                  rows={3}
                  maxLength={MAX_NOTE}
                  value={note}
                  placeholder="For example: more humour, a less obvious culprit, shorter descriptions"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className="muted small">
                With a request, this part is edited to follow it and the rest stays as it is. Without one, it is written again from scratch. You will not
                see the result, only that it changed.
              </p>
            </div>
          )}
          <div className="row">
            <button autoFocus={!pending.note} onClick={() => close(true)}>
              {pending.note && note.trim() ? "Apply request" : "Continue"}
            </button>
            <button className="secondary" onClick={() => close(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
