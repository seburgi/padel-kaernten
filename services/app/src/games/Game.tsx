// Ein Spiel (docs/design/games.md): who is in, who is a reserve, who has
// not answered; saying yes or no; and, for whoever proposed it, the way to
// the venue's booking page, "Gebucht" and cancelling.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, call, useWriteKey, type Game as G } from "../api/client";
import { card, danger, link, primary, quiet } from "../ui";
import { dayLabel, errorText, euros, playing, reserves, shown, span } from "./games";
import { Seats } from "./Seats";

const STATE: Record<string, string> = {
  proposed: "Vorgeschlagen",
  booked: "Gebucht",
  cancelled: "Abgesagt",
};

/** notify is the way to turn Mitteilungen on, from the push slice (App
 * puts it in); shown to whoever is in. */
export function Game({ notify }: { notify?: ReactNode }) {
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
  const full = ins.length >= g.players;
  const booker = proposer ? "Du buchst" : `${shown(g.proposedBy)} bucht`;
  const headline =
    g.state === "booked"
      ? "Gebucht"
      : g.state === "cancelled"
        ? "Abgesagt"
        : full
          ? `Ihr seid vier. ${booker} jetzt.`
          : `Noch ${g.players - ins.length} gesucht`;
  const steps = [
    { label: "Vorgeschlagen", done: true, note: `von ${proposer ? "dir" : shown(g.proposedBy)}` },
    {
      label: "Vier sagen zu",
      done: full || g.state === "booked",
      note: `${ins.length} von ${g.players}`,
    },
    { label: `${booker} bei ${g.venueName}`, done: g.state === "booked", note: "" },
  ];
  const now = steps.findIndex((x) => !x.done);

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
      <div className={`${card} mt-3 mb-4 flex flex-col items-center gap-2 p-4 text-center`}>
        <Seats g={g} big />
        <p className="font-semibold">{headline}</p>
        <p className="text-sm text-ink-muted">
          {g.state === "proposed"
            ? "Vorgeschlagen von "
            : `${STATE[g.state] ?? g.state} · vorgeschlagen von `}
          {proposer ? "dir" : shown(g.proposedBy)}
        </p>
      </div>

      {open && (
        <section className="mb-4" aria-labelledby="next">
          <h2 id="next" className="mb-2 font-semibold">
            So geht es weiter
          </h2>
          <ol className={`${card} space-y-2 p-4`}>
            {steps.map((step, i) => (
              <li
                key={step.label}
                className={`flex items-center gap-3 ${!step.done && i !== now ? "text-ink-faint" : ""}`}
                aria-current={i === now ? "step" : undefined}
              >
                <span
                  className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold ${
                    step.done
                      ? "border-accent bg-accent text-accent-ink"
                      : i === now
                        ? "border-accent text-accent-text"
                        : "border-ink-faint"
                  }`}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <span>
                  <span className="font-semibold">{step.label}</span>
                  {step.note && <span className="text-sm text-ink-muted"> {step.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

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
      {open && (mine === "in" || mine === "reserve") && notify}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">
          Dabei ({ins.length} von {g.players})
        </h2>
        {ins.length > 0 && (
          <ul className={`${card} divide-y divide-line`}>
            {ins.map((p) => (
              <li key={p.email} className="px-4 py-2.5">
                {shown(p)}
                {p.email === email && " (du)"}
              </li>
            ))}
          </ul>
        )}
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
