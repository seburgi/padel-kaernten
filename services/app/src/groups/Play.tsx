// Spielen (docs/design/groups.md): what is on, and one's groups as a row of
// chips at the top (Seb, 2026-11-18). Alle is what waits for the person
// (the games slice's unanswered games, with the invitations from here),
// their games and the times that fit for four, from every group. A group
// chosen turns the page into that group: how it is set up and Verwalten,
// Spiel vorschlagen and Wer kann wann, what waits in it, its games, its
// members. Someone in one group sees no Alle; the page is that group. The
// chosen one is kept on this device, so the tab opens on it again; a group
// one is not in, reached by its address, is Group's page. A person without
// a name is asked for one first, since the others see it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { api, call, useWriteKey, type GroupSummary } from "../api/client";
import { card, field, link, primary, quiet, waits } from "../ui";
import { errorText, useDropInvitation, useGroups, useJoin, useMe } from "./groups";
import { Group, GroupFrame, GroupLine, Members } from "./Group";
import { AddGroup } from "./Groups";
import { PageHead } from "../PageHead";

const KEPT = "padel.play.group";

function kept(): number | "all" | undefined {
  try {
    const v = localStorage.getItem(KEPT);
    if (v === "all") return "all";
    const n = Number(v);
    return v && Number.isSafeInteger(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function keep(v: number | "all") {
  try {
    localStorage.setItem(KEPT, String(v));
  } catch {
    // A private window: the choice lasts this visit only.
  }
}

/** One group's parts from the games slice, which App puts in. */
export type GroupParts = {
  /** Spiel vorschlagen: the button and its sheet. */
  propose?: ReactNode;
  /** Wer kann wann, the group's waiting games and its coming ones. */
  games?: ReactNode;
};

/** waiting is Wartet auf dich, given the invitations and how many there
 * are; games is the coming games and the fits; group is a chosen group's
 * parts and badge what waits in it, on its chip. All from the games slice
 * (App puts them in). group, the address's group, when there is one. */
export function Play({
  waiting = (invites, n) =>
    n > 0 && (
      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Wartet auf dich</h2>
        {invites}
      </section>
    ),
  games,
  start,
  parts,
  badge,
  group,
}: {
  waiting?: (invites: ReactNode, count: number) => ReactNode;
  games?: ReactNode;
  /** The first steps for someone new, from the help slice. */
  start?: ReactNode;
  parts?: (id: number, name: string) => GroupParts;
  badge?: (id: number) => ReactNode;
  group?: number;
}) {
  const me = useMe();
  const groups = useGroups();
  const join = useJoin((id, state) => {
    if (state === "member") choose(id);
  });
  const decline = useDropInvitation();
  const [chosen, setChosen] = useState(kept);
  const [adding, setAdding] = useState(false);
  const invited = groups.data?.filter((g) => g.how === "invited") ?? [];
  const mine = groups.data?.filter((g) => g.how === "member") ?? [];
  const asked = groups.data?.filter((g) => g.how !== "member" && g.requested) ?? [];
  const isMine = (id: number | "all" | undefined) => mine.some((g) => g.id === id);

  function choose(v: number | "all") {
    keep(v);
    setChosen(v);
  }
  // The address's group is the one chosen from now on.
  useEffect(() => {
    if (group !== undefined && isMine(group)) choose(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, groups.data]);

  const selected =
    group !== undefined
      ? group
      : mine.length === 1
        ? mine[0]!.id
        : typeof chosen === "number" && isMine(chosen)
          ? chosen
          : undefined;

  // A group one is not in, reached by its address: its own page.
  if (group !== undefined && groups.data && !isMine(group)) return <Group id={group} />;

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
      <PageHead title="Spielen">Was auf dich wartet und deine nächsten Spiele.</PageHead>
      {groups.data && (
        <Chips
          mine={mine}
          selected={selected}
          badge={badge}
          onAll={() => choose("all")}
          onPick={choose}
          onAdd={() => setAdding(true)}
        />
      )}
      {start}
      {me.data && me.data.name === "" && <NamePrompt />}

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

      {groups.data && selected !== undefined ? (
        <GroupFrame key={selected} id={selected}>
          {(g, myEmail) => {
            const p = parts?.(g.id, g.name) ?? {};
            return (
              <>
                <GroupLine g={g} />
                {p.propose}
                {invited.length > 0 && (
                  <section className="mb-6">
                    <h2 className="mb-2 font-semibold">Einladungen</h2>
                    {invites}
                  </section>
                )}
                {p.games}
                <Members g={g} me={myEmail} />
              </>
            );
          }}
        </GroupFrame>
      ) : (
        groups.data && (
          <>
            {waiting(invites, invited.length)}
            {games}
            {mine.length === 0 && (
              <p className="mb-6 text-ink-muted">
                Du bist noch in keiner Gruppe. Gründe eine, oder schau, welche offen sind.{" "}
                <Link to="/help#gruppen" className={link}>
                  So geht’s
                </Link>
              </p>
            )}
          </>
        )
      )}
      {asked.length > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          Angefragt: {asked.map((g) => g.name).join(", ")}
        </p>
      )}
      {adding && <AddGroup onClose={() => setAdding(false)} />}
    </main>
  );
}

/** Spielen at /groups/:id: the address's group chosen. */
export function PlayGroup(props: Omit<Parameters<typeof Play>[0], "group">) {
  const id = Number(useParams().id);
  // No such address: Group says so.
  if (!Number.isSafeInteger(id)) return <Group />;
  return <Play {...props} group={id} />;
}

function members(n: number) {
  return n === 1 ? "1 Mitglied" : `${n} Mitglieder`;
}

const chip = (on: boolean) =>
  `inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
    on ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-ink hover:bg-hover"
  }`;

/** Alle (with two groups or more), each group, and + Gruppe. */
function Chips({
  mine,
  selected,
  badge,
  onAll,
  onPick,
  onAdd,
}: {
  mine: GroupSummary[];
  selected?: number;
  badge?: (id: number) => ReactNode;
  onAll: () => void;
  onPick: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <nav
      aria-label="Deine Gruppen"
      className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none]"
    >
      {mine.length > 1 && (
        <Link
          to="/play"
          onClick={onAll}
          aria-current={selected === undefined ? "page" : undefined}
          className={chip(selected === undefined)}
        >
          Alle
        </Link>
      )}
      {mine.map((g) => (
        <Link
          key={g.id}
          to={`/groups/${g.id}`}
          onClick={() => onPick(g.id)}
          aria-current={selected === g.id ? "page" : undefined}
          className={chip(selected === g.id)}
        >
          {g.name}
          {selected !== g.id && badge?.(g.id)}
        </Link>
      ))}
      <button type="button" onClick={onAdd} className={`${chip(false)} text-accent-text`}>
        + Gruppe
      </button>
    </nav>
  );
}

/** Dein Name, reached from Mehr: the name the others see, to change. */
export function Profile() {
  const me = useMe();
  return (
    <main>
      <PageHead title="Dein Name">
        So sehen dich die anderen in deinen Gruppen und Spielen.
      </PageHead>
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
