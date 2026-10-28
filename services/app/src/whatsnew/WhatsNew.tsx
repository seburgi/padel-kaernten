// What has changed, newest day first, one card per day. Opening the page
// marks everything read.
import { useEffect } from "react";
import { Link } from "react-router";
import { card, link, quiet } from "../ui";
import { dayLabel, releaseDays } from "./notes";
import { useReleaseNoteList, useReleaseNotes } from "./useReleaseNotes";

const AREAS: Record<string, string> = {
  courts: "Plätze",
  play: "Spielen",
  invites: "Einladen",
  app: "Überall",
};

export function WhatsNew() {
  const { markRead } = useReleaseNotes();
  const { data: notes, isPending, isError, refetch } = useReleaseNoteList();
  const loaded = notes !== undefined;
  useEffect(() => {
    if (loaded) void markRead();
  }, [loaded, markRead]);

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Neu</h1>
      <p className="mb-4 text-ink-muted">
        Was sich in Padel Kärnten geändert hat, das Neueste zuerst.
      </p>
      {isPending && (
        <div
          aria-hidden="true"
          className="h-32 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      )}
      {isError && (
        <div role="alert">
          <p className="mb-3">Die Neuigkeiten konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {loaded && notes.length === 0 && <p className="text-ink-muted">Noch nichts.</p>}
      {releaseDays(notes ?? []).map((day) => (
        <section key={day.date} className={`${card} mb-3 p-4`}>
          <h2 className="text-sm font-semibold text-ink-muted">{dayLabel(day.date)}</h2>
          <div className="mt-2 flex flex-col gap-4">
            {day.notes.map((note) => (
              <article key={note.slug}>
                <h3 className="font-semibold">{note.title}</h3>
                <p className="text-xs text-ink-muted">{AREAS[note.area] ?? note.area}</p>
                {note.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-1.5">
                    {paragraph}
                  </p>
                ))}
                {note.link && (
                  <Link to={note.link} className={`${link} mt-1.5 inline-flex py-1`}>
                    Ansehen
                  </Link>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
