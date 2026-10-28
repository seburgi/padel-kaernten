// Ein Spiel (docs/design/games.md): who is in, who is a reserve, who has
// not answered; saying yes or no; and, for whoever proposed it, the way to
// the venue's booking page, "Gebucht" and cancelling.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, call, useWriteKey, type Game as G } from "../api/client";
import { card, danger, link, primary, quiet } from "../ui";
import { dayLabel, errorText, euros, playing, reserves, shown, span } from "./games";

const STATE: Record<string, string> = {
  proposed: "Vorgeschlagen",
  booked: "Gebucht",
  cancelled: "Abgesagt",
};

export function Game() {
  const id = Number(useParams().id);
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const game = useQuery({
    queryKey: ["game", id],
    queryFn: () => call(api.GET("/api/v1/games/{gameId}", { params: { path: { gameId: id } } })),
    retry: false,
    enabled: Number.isSafeInteger(id),
  });
  const groupId = game.data?.groupId;
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () =>
      call(api.GET("/api/v1/groups/{groupId}", { params: { path: { groupId: groupId! } } })),
    retry: false,
    enabled: groupId !== undefined,
  });
  const done = (g: G) => {
    client.setQueryData(["game", id], g);
    void client.invalidateQueries({ queryKey: ["games"] });
  };
  const answerKey = useWriteKey();
  const answer = useMutation({
    mutationFn: (a: "in" | "out") =>
      call(
        api.PUT("/api/v1/games/{gameId}/players/me", {
          params: { path: { gameId: id }, header: { "Idempotency-Key": answerKey(a) } },
          body: { answer: a },
        }),
      ),
    onSuccess: done,
  });
  const stateKey = useWriteKey();
  const setState = useMutation({
    mutationFn: (state: "booked" | "cancelled") =>
      call(
        api.PATCH("/api/v1/games/{gameId}", {
          params: { path: { gameId: id }, header: { "Idempotency-Key": stateKey(state) } },
          body: { state },
        }),
      ),
    onSuccess: done,
  });
  const [cancelling, setCancelling] = useState(false);

  if (!Number.isSafeInteger(id) || (game.error instanceof ApiError && game.error.status === 404))
    return (
      <main>
        <h1 className="mt-2 mb-2 text-2xl font-semibold">Kein Spiel</h1>
        <p className="mb-4 text-ink-muted">Dieses Spiel gibt es nicht, oder du siehst es nicht.</p>
        <Link to="/play" className={quiet}>
          Zu deinen Spielen
        </Link>
      </main>
    );
  if (game.isPending)
    return (
      <main aria-busy="true" aria-label="Lädt">
        <div className="mt-2 mb-4 h-8 w-56 animate-skeleton rounded-lg bg-sunken" />
        <div className="h-48 animate-skeleton rounded-2xl border border-line bg-sunken" />
      </main>
    );
  if (game.isError)
    return (
      <main className={`${card} mt-2 p-4`} role="alert">
        <p className="mb-3">Das Spiel konnte nicht geladen werden.</p>
        <button type="button" className={quiet} onClick={() => void game.refetch()}>
          Nochmal versuchen
        </button>
      </main>
    );

  const g = game.data;
  const email = me.data?.email ?? "";
  const mine = g.lineup.find((p) => p.email === email)?.state;
  const proposer = g.proposedBy.email === email;
  const open = g.state !== "cancelled";
  const ins = playing(g);
  const res = reserves(g);
  const outs = g.lineup.filter((p) => p.state === "out");
  const answered = new Set(g.lineup.map((p) => p.email));
  const silent = (group.data?.memberList ?? []).filter((m) => !answered.has(m.email));

  return (
    <main>
      <Link to={`/groups/${g.groupId}`} className={`${link} text-sm`}>
        ← {g.groupName}
      </Link>
      <h1 className="mt-1 mb-1 text-2xl font-semibold">
        {dayLabel(g.day)}, {span(g.start, g.minutes)}
      </h1>
      <p className="mb-1 text-ink-muted">
        {g.venueName} · {g.court}
        {g.perHead && ` · ${euros(g.perHead.amount)} pro Kopf`}
      </p>
      <p className="mb-4 text-sm">
        <span className="font-semibold">{STATE[g.state] ?? g.state}</span>
        {g.state === "proposed" ? " von " : " · vorgeschlagen von "}
        {proposer ? "dir" : shown(g.proposedBy)}
        {g.state === "proposed" &&
          (ins.length >= g.players
            ? " · voll, jetzt buchen"
            : ` · noch ${g.players - ins.length} gesucht`)}
      </p>

      {open && (
        <div className="mb-6 flex flex-wrap gap-2">
          {mine === "in" || mine === "reserve" ? (
            <button
              type="button"
              className={quiet}
              disabled={answer.isPending}
              onClick={() => answer.mutate("out")}
            >
              Kann doch nicht
            </button>
          ) : (
            <button
              type="button"
              className={primary}
              disabled={answer.isPending || !me.data}
              onClick={() => answer.mutate("in")}
            >
              {ins.length >= g.players ? "Als Ersatz dabei" : "Bin dabei"}
            </button>
          )}
          {mine === undefined && (
            <button
              type="button"
              className={quiet}
              disabled={answer.isPending || !me.data}
              onClick={() => answer.mutate("out")}
            >
              Kann nicht
            </button>
          )}
        </div>
      )}
      {answer.isError && (
        <p role="alert" className="mb-3 text-sm text-danger-text">
          {errorText(answer.error)}
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">
          Dabei ({ins.length} von {g.players})
        </h2>
        <ul className={`${card} divide-y divide-line`}>
          {ins.map((p) => (
            <li key={p.email} className="px-4 py-2.5">
              {shown(p)}
              {p.email === email && " (du)"}
            </li>
          ))}
          {Array.from({ length: Math.max(0, g.players - ins.length) }, (_, i) => (
            <li key={`free-${i}`} className="px-4 py-2.5 text-ink-faint">
              frei
            </li>
          ))}
        </ul>
        {res.length > 0 && (
          <p className="mt-2 text-sm">
            <span className="font-semibold">Ersatz:</span> {res.map(shown).join(", ")}
          </p>
        )}
        {outs.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">Können nicht: {outs.map(shown).join(", ")}</p>
        )}
        {open && silent.length > 0 && (
          <p className="mt-1 text-sm text-ink-muted">
            Noch keine Antwort: {silent.map(shown).join(", ")}
          </p>
        )}
      </section>

      {proposer && open && (
        <section className="mb-6">
          <h2 className="mb-1 font-semibold">Buchen</h2>
          <p className="mb-2 text-sm text-ink-muted">
            Gebucht wird auf der Seite der Anlage. Danach hier „Gebucht“ tippen, damit alle es
            wissen.
          </p>
          <div className="flex flex-wrap gap-2">
            {g.link && (
              <a href={g.link} target="_blank" rel="noreferrer" className={quiet}>
                Zur Buchung
              </a>
            )}
            {g.state === "proposed" && (
              <button
                type="button"
                className={primary}
                disabled={setState.isPending}
                onClick={() => setState.mutate("booked")}
              >
                Gebucht
              </button>
            )}
          </div>
          <div className="mt-4">
            {cancelling ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={danger}
                  disabled={setState.isPending}
                  onClick={() => setState.mutate("cancelled")}
                >
                  Spiel absagen
                </button>
                <button type="button" className={quiet} onClick={() => setCancelling(false)}>
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`${link} text-sm`}
                onClick={() => setCancelling(true)}
              >
                Spiel absagen …
              </button>
            )}
          </div>
          {setState.isError && (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {errorText(setState.error)}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
