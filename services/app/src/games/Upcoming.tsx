// The coming games, on Spielen (the ones one is in or a reserve for, from
// every group; the unanswered ones wait above, under Wartet auf dich) and
// on a group's page (all of that group's, with the way to its fits). The
// group screens get this from App, so the slices stay apart.
import { Link } from "react-router";
import { card, primary, quiet } from "../ui";
import { answerOf, dayLabel, euros, playing, span, useGames, useMe } from "./games";

export function Upcoming({ group }: { group?: number }) {
  const all = useGames(group);
  const me = useMe();
  const email = me.data?.email;
  const mine = (s: string) => s === "in" || s === "reserve";
  const games =
    group !== undefined
      ? all
      : {
          ...all,
          isPending: all.isPending || email === undefined,
          data: email === undefined ? undefined : all.data?.filter((g) => mine(answerOf(g, email))),
        };

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">{group ? "Spiele" : "Deine nächsten Spiele"}</h2>
      {group !== undefined && (
        <Link to={`/groups/${group}/fits`} className={`${primary} mb-3`}>
          Wann passt es für vier?
        </Link>
      )}
      {games.isPending && (
        <div
          aria-busy="true"
          aria-label="Lädt"
          className="h-16 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      )}
      {all.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Die Spiele konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void all.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {games.data?.length === 0 && (
        <p className="text-sm text-ink-muted">
          {group === undefined
            ? "Noch kein Spiel, bei dem du dabei bist."
            : "Noch kein Spiel geplant."}
        </p>
      )}
      {games.data && games.data.length > 0 && (
        <ul className="space-y-2">
          {games.data.map((g) => (
            <li key={g.id}>
              <Link to={`/games/${g.id}`} className={`${card} block p-4 hover:bg-hover`}>
                <div className="font-semibold">
                  {dayLabel(g.day)}, {span(g.start, g.minutes)} · {g.venueName}
                </div>
                <div className="text-sm text-ink-muted">
                  {g.state === "booked" ? "Gebucht" : `${playing(g).length} von ${g.players} dabei`}
                  {email !== undefined && answerOf(g, email) === "reserve" && " · du bist Ersatz"}
                  {group === undefined && ` · ${g.groupName}`}
                  {g.perHead && ` · ${euros(g.perHead.amount)} pro Kopf`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
