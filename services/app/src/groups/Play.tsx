// Spielen (docs/design/groups.md): the groups one is in, the invitations
// waiting for an answer, and the way to say when one can. A person without
// a name is asked for one first, since the others see it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, call, useWriteKey, type GroupSummary } from "../api/client";
import { card, field, link, primary, quiet } from "../ui";
import { errorText, kindLabel, useDropInvitation, useGroups, useJoin, useMe } from "./groups";

/** games is the coming games, from the games slice (App puts it in). */
export function Play({ games }: { games?: ReactNode }) {
  const me = useMe();
  const groups = useGroups();
  const join = useJoin();
  const decline = useDropInvitation();
  const invited = groups.data?.filter((g) => g.how === "invited") ?? [];
  const mine = groups.data?.filter((g) => g.how === "member") ?? [];
  const asked = groups.data?.filter((g) => g.how !== "member" && g.requested) ?? [];

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Spielen</h1>
      <p className="mb-4 text-ink-muted">
        Sag, wann du kannst. Deine Gruppen sehen es und finden so eine Zeit, die für alle passt.
      </p>
      {me.data && me.data.name === "" && <NamePrompt />}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/availability" className={primary}>
          Wann kann ich?
        </Link>
        <Link to="/groups" className={quiet}>
          Gruppen finden
        </Link>
      </div>

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

      {invited.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Einladungen</h2>
          <ul className="space-y-2">
            {invited.map((g) => (
              <li key={g.id} className={`${card} flex flex-wrap items-center gap-3 p-4`}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{g.name}</div>
                  <div className="text-sm text-ink-muted">{members(g.members)}</div>
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
        </section>
      )}

      {groups.data && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Deine Gruppen</h2>
            <Link to="/groups/new" className={`${link} text-sm`}>
              Neue Gruppe
            </Link>
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

function NamePrompt() {
  const client = useQueryClient();
  const [name, setName] = useState("");
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
          disabled={!name.trim() || save.isPending}
          aria-busy={save.isPending}
        >
          Speichern
        </button>
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(save.error)}
        </p>
      )}
    </form>
  );
}
