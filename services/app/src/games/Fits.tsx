// Wann passt es für vier? (docs/design/games.md): the games the group's
// times and the free courts allow, one tap from proposing one. The fits come
// from the latest snapshot; one older than five minutes is refreshed once
// on opening, as on the courts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, call, newKey, useWriteKey, type Fit } from "../api/client";
import { card, link, pressed, primary, quiet } from "../ui";
import { clock, dayLabel, errorText, euros, shown, span } from "./games";

const DURATIONS = [60, 90, 120] as const;
const STALE_MS = 5 * 60 * 1000;

export function Fits() {
  const id = Number(useParams().id);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>(90);
  const fits = useQuery({
    queryKey: ["fits", id, minutes],
    queryFn: () =>
      call(
        api.GET("/api/v1/groups/{groupId}/fits", {
          params: { path: { groupId: id }, query: { minutes } },
        }),
      ),
    retry: false,
  });
  const group = useQuery({
    queryKey: ["group", id],
    queryFn: () => call(api.GET("/api/v1/groups/{groupId}", { params: { path: { groupId: id } } })),
    retry: false,
  });

  // Once per opening: a snapshot older than five minutes, or none, is
  // asked for again, and the fits follow it.
  const refresh = useMutation({
    mutationFn: () =>
      call(
        api.POST("/api/v1/slots/refresh", { params: { header: { "Idempotency-Key": newKey() } } }),
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: ["fits", id] }),
  });
  const asked = useRef(false);
  const noSnapshot = fits.error instanceof ApiError && fits.error.kind === "no-snapshot";
  const takenAt = fits.data?.takenAt;
  const { mutate } = refresh;
  useEffect(() => {
    const stale = takenAt !== undefined && Date.now() - new Date(takenAt).getTime() > STALE_MS;
    if (asked.current || !(stale || noSnapshot)) return;
    asked.current = true;
    mutate();
  }, [takenAt, noSnapshot, mutate]);

  const key = useWriteKey();
  const propose = useMutation({
    mutationFn: (f: Fit) => {
      const body = {
        venueId: f.venueId,
        court: f.court,
        day: f.day,
        start: f.start,
        minutes: f.minutes,
      };
      return call(
        api.POST("/api/v1/groups/{groupId}/games", {
          params: { path: { groupId: id }, header: { "Idempotency-Key": key(body) } },
          body,
        }),
      );
    },
    onSuccess: (g) => {
      void client.invalidateQueries({ queryKey: ["games"] });
      navigate(`/games/${g.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.kind === "court-gone")
        void client.invalidateQueries({ queryKey: ["fits", id] });
    },
  });

  const notMember = fits.error instanceof ApiError && fits.error.status === 404 && !noSnapshot;
  if (notMember)
    return (
      <main>
        <h1 className="mt-2 mb-2 text-2xl font-semibold">Keine Gruppe</h1>
        <p className="mb-4 text-ink-muted">Passende Zeiten sieht nur, wer in der Gruppe ist.</p>
        <Link to="/play" className={quiet}>
          Zu deinen Gruppen
        </Link>
      </main>
    );

  const days = groupByDay(fits.data?.fits ?? []);
  return (
    <main>
      <Link to={`/groups/${id}`} className={`${link} text-sm`}>
        ← {group.data?.name ?? "Gruppe"}
      </Link>
      <h1 className="mt-1 mb-1 text-2xl font-semibold">Wann passt es für vier?</h1>
      <p className="mb-3 text-ink-muted">
        Zeiten, zu denen vier von euch können und ein Platz frei ist.
        {fits.data &&
          ` Plätze laut Stand ${new Date(fits.data.takenAt).toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" })}.`}
      </p>
      <div className="mb-4 flex gap-2" role="group" aria-label="Wie lange?">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={minutes === d}
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(minutes === d)}`}
            onClick={() => setMinutes(d)}
          >
            {d} Min
          </button>
        ))}
      </div>
      {refresh.isPending && (
        <p role="status" className="mb-3 text-sm text-ink-muted">
          Frage die Anlagen ab …
        </p>
      )}

      {(fits.isPending || (noSnapshot && refresh.isPending)) && (
        <div aria-busy="true" aria-label="Lädt">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mb-2 h-20 animate-skeleton rounded-2xl border border-line bg-sunken"
            />
          ))}
        </div>
      )}
      {fits.isError && !(noSnapshot && refresh.isPending) && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">
            {noSnapshot
              ? errorText(fits.error)
              : "Die passenden Zeiten konnten nicht geladen werden."}
          </p>
          <button type="button" className={quiet} onClick={() => void fits.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {propose.isError && (
        <p role="alert" className="mb-3 text-sm text-danger-text">
          {errorText(propose.error)}
        </p>
      )}

      {fits.data && fits.data.fits.length === 0 && (
        <div className={`${card} mb-4 p-4`}>
          <p className="mb-3">
            Gerade passt nichts für vier. Je mehr ihr eintragt, wann ihr könnt, desto eher findet
            sich etwas.
          </p>
          <Link to="/availability" className={quiet}>
            Wann kann ich?
          </Link>
        </div>
      )}
      {days.map(([day, list]) => (
        <section key={day} className="mb-4">
          <h2 className="mb-2 font-semibold">{dayLabel(day)}</h2>
          <ul className="space-y-2">
            {list.map((f) => (
              <li key={`${f.venueId}-${f.start}`} className={`${card} p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {span(f.start, f.minutes)} · {f.venueName}
                    </div>
                    <div className="text-sm text-ink-muted">
                      {f.court}
                      {f.perHead && ` · ${euros(f.perHead.amount)} pro Kopf`}
                    </div>
                    <div className="mt-1 text-sm">
                      {f.can.length} können: {f.can.map(shown).join(", ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={primary}
                    disabled={propose.isPending}
                    aria-label={`${dayLabel(f.day)} ${clock(f.start)} in ${f.venueName} vorschlagen`}
                    onClick={() => propose.mutate(f)}
                  >
                    Vorschlagen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {fits.data && fits.data.nearly.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 font-semibold">Fast: eine Person fehlt</h2>
          <p className="mb-2 text-sm text-ink-muted">
            Drei können. Wer für den Tag noch nichts eingetragen hat, könnte die vierte sein.
          </p>
          <ul className={`${card} divide-y divide-line`}>
            {fits.data.nearly.map((f) => (
              <li key={`${f.day}-${f.venueId}-${f.start}`} className="px-4 py-2.5 text-sm">
                <div className="font-semibold">
                  {dayLabel(f.day)} {span(f.start, f.minutes)} · {f.venueName}
                </div>
                <div className="text-ink-muted">
                  {f.can.map(shown).join(", ")} können. Frag {f.ask.map(shown).join(" oder ")}.
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function groupByDay(fits: Fit[]): [string, Fit[]][] {
  const by = new Map<string, Fit[]>();
  for (const f of [...fits].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)) {
    by.set(f.day, [...(by.get(f.day) ?? []), f]);
  }
  return [...by.entries()];
}
