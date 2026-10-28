// The coming games, on Spielen (every group) and on a group's page (that
// group, with the way to its fits). The group screens get this from App, so
// the slices stay apart.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, call } from "../api/client";
import { card, primary, quiet } from "../ui";
import { dayLabel, euros, playing, span } from "./games";

export function Upcoming({ group }: { group?: number }) {
  const games = useQuery({
    queryKey: ["games", group ?? "all"],
    queryFn: async () =>
      (await call(api.GET("/api/v1/games", { params: { query: group ? { groupId: group } : {} } })))
        .items,
    retry: false,
  });

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">{group ? "Spiele" : "Nächste Spiele"}</h2>
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
      {games.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Die Spiele konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void games.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {games.data?.length === 0 && (
        <p className="text-sm text-ink-muted">
          Noch kein Spiel geplant.
          {group === undefined && " In einer Gruppe siehst du, wann es für vier passt."}
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
