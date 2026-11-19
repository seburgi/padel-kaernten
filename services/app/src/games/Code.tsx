// The access code of a booked game (Seb, 2026-11-19; docs/design/games.md):
// some venues, like Padel Ten, give a code to type in at the door. Whoever
// proposed the game enters it when saying Gebucht or later; those playing
// and the reserves see it on the game. The API hands it to nobody else.
import { Sheet } from "@burgstaller/web/sheet";
import { useId, useState } from "react";
import type { Game } from "../api/client";
import { card, field, link, primary, quiet } from "../ui";
import { errorText } from "./games";

/** The longest code the API takes (games.MaxCode). */
export const MAX_CODE = 40;

/** The code on a booked game: big enough to read at the door, with a way
 * to copy it; for whoever proposed it, a way to enter or change it. */
export function CodeCard({
  g,
  proposer,
  onEdit,
}: {
  g: Game;
  proposer: boolean;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (g.state !== "booked" || (!g.code && !proposer)) return null;
  if (!g.code)
    return (
      <div className={`${card} mb-4 flex items-center justify-between gap-3 px-4 py-3`}>
        <span className="min-w-0 text-sm text-ink-muted">
          Hat die Anlage einen Zugangscode für die Tür geschickt?
        </span>
        <button type="button" className={`${quiet} shrink-0`} onClick={onEdit}>
          Code eintragen
        </button>
      </div>
    );
  const code = g.code;
  const copy =
    typeof navigator !== "undefined" && navigator.clipboard
      ? () =>
          void navigator.clipboard.writeText(code).then(
            () => setCopied(true),
            () => {},
          )
      : undefined;
  return (
    <section
      aria-label="Zugangscode"
      className={`${card} mb-4 flex items-center justify-between gap-3 px-4 py-3`}
    >
      <span className="min-w-0">
        <span className="block text-sm text-ink-muted">Zugangscode für den Eingang</span>
        <span className="block font-mono text-2xl font-semibold tracking-wider break-all">
          {code}
        </span>
        {proposer && (
          <button type="button" className={`${link} text-sm`} onClick={onEdit}>
            Ändern
          </button>
        )}
      </span>
      {copy && (
        <button type="button" className={`${quiet} shrink-0`} onClick={copy} aria-live="polite">
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      )}
    </section>
  );
}

/** Where whoever proposed the game enters the code: when saying Gebucht
 * (booking), or later on its own. An empty field books without a code, or
 * takes the code away. */
export function CodeSheet({
  booking,
  initial,
  busy,
  error,
  onSave,
  onClose,
}: {
  booking: boolean;
  initial: string;
  busy: boolean;
  error: unknown;
  onSave: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(initial);
  const id = useId();
  const title = booking ? "Als gebucht markieren" : "Zugangscode";
  return (
    <Sheet label={title} wide="dialog" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(code.trim());
        }}
      >
        <h2 className="mb-1 text-lg font-semibold">{title}</h2>
        {booking && (
          <p className="mb-3 text-sm text-ink-muted">
            Alle, die dabei sind, bekommen eine Mitteilung.
          </p>
        )}
        <label htmlFor={id} className="mb-1 block font-semibold">
          Zugangscode
          {booking && <span className="font-normal text-ink-muted"> (falls es einen gibt)</span>}
        </label>
        <input
          id={id}
          className={`${field} w-full font-mono tracking-wider`}
          value={code}
          maxLength={MAX_CODE}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
        />
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          Manche Anlagen, wie Padel Ten, schicken einen Code für die Tür. Ihn sehen alle, die
          mitspielen, auch die Ersatzleute.
          {!booking && initial && " Leer lassen nimmt ihn weg."}
        </p>
        {error != null && (
          <p role="alert" className="mb-3 text-sm text-danger-text">
            {errorText(error)}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button type="submit" className={`${primary} w-full`} disabled={busy}>
            {booking ? "Gebucht" : "Speichern"}
          </button>
          <button type="button" className={`${quiet} w-full`} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </Sheet>
  );
}
