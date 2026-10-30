// Passt für vier on Spielen (Seb, 2026-10-29): the soonest times, from
// every group one is in, where four can and a court is free, one tap from
// proposing; on a group's page the same for that group alone. Alle Zeiten
// on Spielen opens the whole list from every group in a sheet (Seb,
// 2026-10-30: a link into one group's page made no sense there), shown only
// when there is more than the three; on a group's page it is the group's
// "Wann passt es für vier?".
// Times already proposed as a game are left out. 90 minutes, the default
// there; the snapshot is not refreshed here, the schedule keeps it fresh.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, call, useWriteKey, type Fit } from "../api/client";
import { Sheet } from "../Sheet";
import { card, link, quiet } from "../ui";
import { clock, dayLabel, errorText, euros, shown, span, useGames } from "./games";

const MINUTES = 90;
const SHOWN = 3;

type Pick = { f: Fit; groupId: number; groupName: string };

export function BestFits({ group }: { group?: number }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
  });
  const mine =
    groups.data?.filter((g) => g.how === "member" && (group === undefined || g.id === group)) ?? [];
  const fits = useQueries({
    queries: mine.map((g) => ({
      queryKey: ["fits", g.id, MINUTES],
      queryFn: () =>
        call(
          api.GET("/api/v1/groups/{groupId}/fits", {
            params: { path: { groupId: g.id }, query: { minutes: MINUTES } },
          }),
        ),
      retry: false,
    })),
  });
  const games = useGames();
  const [all, setAll] = useState(false);

  const key = useWriteKey();
  const propose = useMutation({
    mutationFn: ({ f, groupId }: Pick) => {
      const body = {
        venueId: f.venueId,
        court: f.court,
        day: f.day,
        start: f.start,
        minutes: f.minutes,
      };
      return call(
        api.POST("/api/v1/groups/{groupId}/games", {
          params: { path: { groupId }, header: { "Idempotency-Key": key({ groupId, ...body }) } },
          body,
        }),
      );
    },
    onSuccess: (g) => {
      void client.invalidateQueries({ queryKey: ["games"] });
      navigate(`/games/${g.id}`);
    },
    onError: (e, { groupId }) => {
      if (e instanceof ApiError && e.kind === "court-gone")
        void client.invalidateQueries({ queryKey: ["fits", groupId] });
    },
  });

  if (mine.length === 0) return null;
  const proposed = new Set(
    (games.data ?? [])
      .filter((g) => g.state !== "cancelled")
      .map((g) => `${g.groupId}/${g.venueId}/${g.court}/${g.day}/${g.start}`),
  );
  const every: Pick[] = fits
    .flatMap((q, i) =>
      (q.data?.fits ?? []).map((f) => ({ f, groupId: mine[i]!.id, groupName: mine[i]!.name })),
    )
    .filter(
      (p) => !proposed.has(`${p.groupId}/${p.f.venueId}/${p.f.court}/${p.f.day}/${p.f.start}`),
    )
    .sort((a, b) => a.f.day.localeCompare(b.f.day) || a.f.start - b.f.start);
  const picks = every.slice(0, SHOWN);
  const loading = fits.some((q) => q.isPending);
  const failed = fits.length > 0 && fits.every((q) => q.isError);
  const one = mine.length === 1 ? mine[0]! : undefined;

  return (
    <section className="mb-6" aria-labelledby="best-fits">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="best-fits" className="font-semibold">
          Passt für vier
        </h2>
        {group !== undefined ? (
          <Link to={`/groups/${group}/fits`} className={`${link} text-sm whitespace-nowrap`}>
            Alle Zeiten
          </Link>
        ) : (
          every.length > SHOWN && (
            <button
              type="button"
              className={`${link} text-sm whitespace-nowrap`}
              onClick={() => setAll(true)}
            >
              Alle Zeiten ({every.length})
            </button>
          )
        )}
      </div>
      {loading && picks.length === 0 && (
        <div
          aria-busy="true"
          aria-label="Lädt"
          className="h-16 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      )}
      {failed && (
        <p className="text-sm text-ink-muted" role="alert">
          Die passenden Zeiten konnten nicht geladen werden.
        </p>
      )}
      {!loading && !failed && picks.length === 0 && (
        <p className="text-sm text-ink-muted">
          Gerade passt nichts für vier. Je mehr ihr eintragt, wann ihr könnt, desto eher findet sich
          etwas.{" "}
          <Link to="/availability" className={link}>
            Wann kann ich?
          </Link>
        </p>
      )}
      {picks.length > 0 && <ul className="space-y-2">{picks.map((p) => row(p, true, !one))}</ul>}
      {propose.isError && !all && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(propose.error)}
        </p>
      )}
      {all && (
        <Sheet label="Alle passenden Zeiten" wide="float" onClose={() => setAll(false)}>
          <h2 className="mb-1 text-lg font-semibold">Alle passenden Zeiten</h2>
          <p className="mb-3 text-sm text-ink-muted">
            {MINUTES} Minuten{mine.length > 1 ? ", aus all deinen Gruppen" : ""}.
          </p>
          {propose.isError && (
            <p role="alert" className="mb-3 text-sm text-danger-text">
              {errorText(propose.error)}
            </p>
          )}
          {byDay(every).map(([day, list]) => (
            <section key={day} className="mb-4">
              <h3 className="mb-2 font-semibold">{dayLabel(day)}</h3>
              <ul className="space-y-2">{list.map((p) => row(p, false, !one))}</ul>
            </section>
          ))}
          <p className="mb-3 text-sm text-ink-muted">
            Andere Längen, und wo nur eine Person fehlt:{" "}
            {mine.map((g, i) => (
              <span key={g.id}>
                {i > 0 && ", "}
                <Link to={`/groups/${g.id}/fits`} className={link}>
                  {g.name}
                </Link>
              </span>
            ))}
          </p>
          <button type="button" className={quiet} onClick={() => setAll(false)}>
            Schließen
          </button>
        </Sheet>
      )}
    </section>
  );

  function row(p: Pick, withDay: boolean, withGroup: boolean) {
    return (
      <li
        key={keyOf(p)}
        className={`${card} flex flex-wrap items-center justify-between gap-2 p-4`}
      >
        <div className="min-w-0">
          <div className="font-semibold">
            {withDay && `${dayLabel(p.f.day)}, `}
            {span(p.f.start, p.f.minutes)}
            {!withDay && ` · ${p.f.venueName}`}
          </div>
          <div className="text-sm text-ink-muted">
            {withDay ? p.f.venueName : p.f.court}
            {p.f.perHead && ` · ${euros(p.f.perHead.amount)} pro Kopf`}
            {withGroup && ` · ${p.groupName}`}
          </div>
          <div className="text-sm">
            {p.f.can.length} können: {p.f.can.map(shown).join(", ")}
          </div>
        </div>
        <button
          type="button"
          className={quiet}
          disabled={propose.isPending}
          aria-label={`${dayLabel(p.f.day)} ${clock(p.f.start)} in ${p.f.venueName} vorschlagen`}
          onClick={() => propose.mutate(p)}
        >
          Vorschlagen
        </button>
      </li>
    );
  }
}

const keyOf = (p: Pick) => `${p.groupId}-${p.f.venueId}-${p.f.court}-${p.f.day}-${p.f.start}`;

function byDay(picks: Pick[]): [string, Pick[]][] {
  const by = new Map<string, Pick[]>();
  for (const p of picks) by.set(p.f.day, [...(by.get(p.f.day) ?? []), p]);
  return [...by.entries()];
}
