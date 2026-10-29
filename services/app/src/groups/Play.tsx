// Spielen (docs/design/groups.md): what is on. First what waits for the
// person (the games slice's unanswered games, with the invitations from
// here), then the games and the times that fit for four (from the games
// slice too; App puts both in), then the groups one is in. A person
// without a name is asked for one first, since the others see it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, call, useWriteKey, type GroupSummary } from "../api/client";
import { card, field, link, primary, quiet, waits } from "../ui";
import { errorText, kindLabel, useDropInvitation, useGroups, useJoin, useMe } from "./groups";

/** waiting is Wartet auf dich, given the invitations and how many there
 * are; games is the coming games and the fits. Both are the games
 * slice's (App puts them in). */
export function Play({
  waiting = (invites, n) =>
    n > 0 && (
      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Wartet auf dich</h2>
        {invites}
      </section>
    ),
  games,
}: {
  waiting?: (invites: ReactNode, count: number) => ReactNode;
  games?: ReactNode;
}) {
  const me = useMe();
  const groups = useGroups();
  const join = useJoin();
  const decline = useDropInvitation();
  const invited = groups.data?.filter((g) => g.how === "invited") ?? [];
  const mine = groups.data?.filter((g) => g.how === "member") ?? [];
  const asked = groups.data?.filter((g) => g.how !== "member" && g.requested) ?? [];

  const invites = invited.length > 0 && (
    <>
      <ul className="space-y-2">
        {invited.map((g) => (
          <li key={g.id} className={`${waits} flex flex-wrap items-center gap-3 p-4`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{g.name}</div>
              <div className="text-sm text-ink-muted">Einladung · {members(g.members)}</div>
            </div>
            <button
              type="button"
              className={primary}
              disabled={join.isPending}
              onClick={() => join.mutate(g.id)}
            >
              Annehmen
            </button>
            <button
              type="button"
              className={quiet}
              disabled={decline.isPending || !me.data}
              onClick={() => me.data && decline.mutate({ id: g.id, email: me.data.email })}
            >
              Ablehnen
            </button>
          </li>
        ))}
      </ul>
      {(join.isError || decline.isError) && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(join.error ?? decline.error)}
        </p>
      )}
    </>
  );

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Spielen</h1>
      <p className="mb-4 text-ink-muted">
        Was auf dich wartet, deine Spiele und wann es für vier passt.
      </p>
      {me.data && me.data.name === "" && <NamePrompt />}

      {waiting(invites, invited.length)}

      {games}

      {groups.isPending && (
        <div aria-busy="true" aria-label="Lädt">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="mb-2 h-16 animate-skeleton rounded-2xl border border-line bg-sunken"
            />
          ))}
        </div>
      )}
      {groups.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Deine Gruppen konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void groups.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}

      {groups.data && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Deine Gruppen</h2>
            <span className="flex gap-3">
              <Link to="/groups" className={`${link} text-sm`}>
                Gruppen finden
              </Link>
              <Link to="/groups/new" className={`${link} text-sm`}>
                Neue Gruppe
              </Link>
            </span>
          </div>
          {mine.length === 0 ? (
            <p className="text-ink-muted">
              Du bist noch in keiner Gruppe. Gründe eine, oder schau, welche offen sind.{" "}
              <Link to="/help#gruppen" className={link}>
                So geht’s
              </Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {mine.map((g) => (
                <GroupCard key={g.id} g={g} />
              ))}
            </ul>
          )}
          {asked.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Angefragt: {asked.map((g) => g.name).join(", ")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function members(n: number) {
  return n === 1 ? "1 Mitglied" : `${n} Mitglieder`;
}

function GroupCard({ g }: { g: GroupSummary }) {
  return (
    <li>
      <Link to={`/groups/${g.id}`} className={`${card} block p-4 hover:bg-hover`}>
        <div className="font-semibold">{g.name}</div>
        <div className="text-sm text-ink-muted">
          {members(g.members)} · {kindLabel(g.kind)}
          {g.role === "admin" && " · du bist Admin"}
        </div>
      </Link>
    </li>
  );
}

/** Dein Name, reached from Mehr: the name the others see, to change. */
export function Profile() {
  const me = useMe();
  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Dein Name</h1>
      <p className="mb-4 text-ink-muted">
        So sehen dich die anderen in deinen Gruppen und Spielen.
      </p>
      {me.data && <NamePrompt initial={me.data.name} />}
    </main>
  );
}

function NamePrompt({ initial = "" }: { initial?: string }) {
  const client = useQueryClient();
  const [name, setName] = useState(initial);
  const key = useWriteKey();
  const save = useMutation({
    mutationFn: (n: string) =>
      call(
        api.PUT("/api/v1/me/name", {
          params: { header: { "Idempotency-Key": key(n) } },
          body: { name: n },
        }),
      ),
    onSuccess: (me) => client.setQueryData(["me"], me),
  });
  return (
    <form
      className={`${card} mb-4 p-4`}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate(name.trim());
      }}
    >
      <label htmlFor="my-name" className="mb-2 block font-semibold">
        Wie sollen dich die anderen sehen?
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="my-name"
          className={`${field} min-w-0 flex-1`}
          placeholder="Vorname"
          maxLength={40}
          autoComplete="given-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          className={quiet}
          disabled={!name.trim() || name.trim() === initial || save.isPending}
          aria-busy={save.isPending}
        >
          Speichern
        </button>
      </div>
      {save.isSuccess && initial !== "" && (
        <p role="status" className="mt-2 text-sm text-ink-muted">
          Gespeichert.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(save.error)}
        </p>
      )}
    </form>
  );
}
