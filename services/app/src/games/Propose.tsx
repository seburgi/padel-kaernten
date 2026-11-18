// Spiel vorschlagen (Seb, 2026-11-18): the one way into proposing a game,
// on Spielen with a group chosen. A sheet with the length, the group's
// soonest times that fit for four (BestFits, bare), and the ways to look
// further: Alle Zeiten (the group's Wann passt es für vier?), Wer kann
// wann, and a free court of one's own choosing on Plätze, whose start
// times ask the group (AskGroup).
import { Sheet } from "@burgstaller/web/sheet";
import { useState } from "react";
import { Link } from "react-router";
import { card, primary, quiet } from "../ui";
import { BestFits } from "./BestFits";
import { Durations, type Duration } from "./Durations";

export function Propose({ group, name }: { group: number; name?: string }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<Duration>(90);
  const ways = [
    {
      to: `/groups/${group}/fits`,
      label: "Alle Zeiten",
      note: "Jede Zeit, auch wo eine Person fehlt",
    },
    {
      to: `/groups/${group}/who-can`,
      label: "Wer kann wann",
      note: "14 Tage auf einen Blick, und warum es wann nicht passt",
    },
    { to: "/", label: "Freien Platz selbst wählen", note: "Alle Plätze, dann die Gruppe fragen" },
  ];
  return (
    <>
      <button type="button" className={`${primary} mb-5 w-full`} onClick={() => setOpen(true)}>
        Spiel vorschlagen
      </button>
      {open && (
        <Sheet label="Spiel vorschlagen" wide="float" onClose={() => setOpen(false)}>
          <h2 className="mb-1 text-lg font-semibold">Spiel vorschlagen</h2>
          <p className="mb-3 text-sm text-ink-muted">
            {name ? `${name}: ` : ""}die nächsten Zeiten, zu denen vier können und ein Platz frei
            ist.
          </p>
          <Durations minutes={minutes} onChange={setMinutes} className="mb-3" />
          <BestFits group={group} minutes={minutes} bare />
          <ul className={`${card} m-0 mb-4 list-none divide-y divide-line p-0`}>
            {ways.map((w) => (
              <li key={w.to}>
                <Link
                  to={w.to}
                  className="flex min-h-(--size-control-touch) items-center gap-3 px-4 py-3 hover:bg-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{w.label}</span>
                    <span className="block text-sm text-ink-muted">{w.note}</span>
                  </span>
                  <span aria-hidden="true" className="text-ink-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" className={`${quiet} w-full`} onClick={() => setOpen(false)}>
            Schließen
          </button>
        </Sheet>
      )}
    </>
  );
}
