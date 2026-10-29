// Wartet auf dich (Seb, 2026-10-29): first on Spielen, what waits for the
// person: a proposed game they have not answered, with Bin dabei and Kann
// nicht on its card, and the group invitations the groups slice hands in
// (App puts them in, so the slices stay apart). Nothing waiting, nothing
// shown.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { api, call, useWriteKey, type Game } from "../api/client";
import { primary, quiet, waits } from "../ui";
import { answerOf, dayLabel, errorText, euros, span, useGames, useMe } from "./games";
import { Seats, wanted } from "./Seats";

export function Waiting({ invites, invited = 0 }: { invites?: ReactNode; invited?: number }) {
  const me = useMe();
  const games = useGames();
  const email = me.data?.email;
  const open =
    email === undefined
      ? []
      : (games.data ?? []).filter((g) => g.state === "proposed" && answerOf(g, email) === "none");
  const count = open.length + invited;
  if (count === 0) return null;
  return (
    <section className="mb-6" aria-labelledby="waiting">
      <h2 id="waiting" className="mb-2 flex items-center gap-2 font-semibold">
        Wartet auf dich
        <span className="rounded-full border border-warning-border bg-warning-subtle px-2 text-[13px] text-warning-text">
          {count}
        </span>
      </h2>
      {open.length > 0 && (
        <ul className="mb-2 space-y-2">
          {open.map((g) => (
            <Ask key={g.id} g={g} />
          ))}
        </ul>
      )}
      {invites}
    </section>
  );
}

function Ask({ g }: { g: Game }) {
  const client = useQueryClient();
  const key = useWriteKey();
  const answer = useMutation({
    mutationFn: (a: "in" | "out") =>
      call(
        api.PUT("/api/v1/games/{gameId}/players/me", {
          params: { path: { gameId: g.id }, header: { "Idempotency-Key": key(a) } },
          body: { answer: a },
        }),
      ),
    onSuccess: (next) => {
      client.setQueryData(["game", g.id], next);
      void client.invalidateQueries({ queryKey: ["games"] });
    },
  });
  return (
    <li className={`${waits} p-4`}>
      <Link to={`/games/${g.id}`} className="block">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="font-semibold">
            {dayLabel(g.day)}, {span(g.start, g.minutes)}
          </span>
          <span className="text-sm text-ink-muted">{g.groupName}</span>
        </div>
        <div className="text-sm text-ink-muted">
          {g.venueName} · {g.court}
          {g.perHead && ` · ${euros(g.perHead.amount)} pro Kopf`}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Seats g={g} />
          <span className="text-sm text-ink-muted">{wanted(g)}</span>
        </div>
      </Link>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={`${primary} flex-1`}
          disabled={answer.isPending}
          onClick={() => answer.mutate("in")}
        >
          Bin dabei
        </button>
        <button
          type="button"
          className={`${quiet} flex-1`}
          disabled={answer.isPending}
          onClick={() => answer.mutate("out")}
        >
          Kann nicht
        </button>
      </div>
      {answer.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(answer.error)}
        </p>
      )}
    </li>
  );
}
