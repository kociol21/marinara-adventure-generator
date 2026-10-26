import { useEffect, useRef, useState } from "react";

/**
 * In-page replacement for window.confirm, which some embedded browsers suppress (it then returns
 * false and the action silently never happens). Mount <ConfirmHost /> once; call askConfirm anywhere.
 */
interface Pending {
  message: string;
  resolve: (ok: boolean) => void;
}

let show: ((pending: Pending) => void) | null = null;

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ message, resolve });
    else resolve(window.confirm(message));
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    show = (next) =>
      setPending((current) => {
        current?.resolve(false);
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
    pending?.resolve(ok);
    setPending(null);
    dialog.current?.close();
  };

  return (
    <dialog ref={dialog} className="confirm-dialog" onCancel={() => close(false)}>
      {pending && (
        <>
          {pending.message.split("\n").map((line, i) => (line ? <p key={i}>{line}</p> : null))}
          <div className="row">
            <button autoFocus onClick={() => close(true)}>
              Continue
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
