// One group (docs/design/groups.md): its page, with what fits and its games
// for members and who is in it; and its own page Verwalten
// (/groups/:id/settings, Seb 2026-10-29) with everything about the group
// itself: where it plays, the members (removing them, for admins), who
// asked in, inviting, the name and who may join (admins), and leaving.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, call, useWriteKey, type Group as G } from "../api/client";
import { card, danger, field, link, pressed, primary, quiet, waits } from "../ui";
import {
  areaLabel,
  errorText,
  KINDS,
  kindLabel,
  useDropInvitation,
  useJoin,
  useMe,
} from "./groups";

/** Loads the group by the address and says when it cannot. */
function GroupFrame({ children }: { children: (g: G, me: string) => ReactNode }) {
  const id = Number(useParams().id);
  const me = useMe();
  const group = useQuery({
    queryKey: ["group", id],
    queryFn: () => call(api.GET("/api/v1/groups/{groupId}", { params: { path: { groupId: id } } })),
    retry: false,
    enabled: Number.isSafeInteger(id),
  });

  if (!Number.isSafeInteger(id) || (group.error instanceof ApiError && group.error.status === 404))
    return (
      <main>
        <h1 className="mt-2 mb-2 text-2xl font-semibold">Keine Gruppe</h1>
        <p className="mb-4 text-ink-muted">Diese Gruppe gibt es nicht, oder du siehst sie nicht.</p>
        <Link to="/play" className={quiet}>
          Zu deinen Gruppen
        </Link>
      </main>
    );
  if (group.isPending)
    return (
      <main aria-busy="true" aria-label="Lädt">
        <div className="mt-2 mb-4 h-8 w-48 animate-skeleton rounded-lg bg-sunken" />
        <div className="h-40 animate-skeleton rounded-2xl border border-line bg-sunken" />
      </main>
    );
  if (group.isError)
    return (
      <main className={`${card} mt-2 p-4`} role="alert">
        <p className="mb-3">Die Gruppe konnte nicht geladen werden.</p>
        <button type="button" className={quiet} onClick={() => void group.refetch()}>
          Nochmal versuchen
        </button>
      </main>
    );
  return <>{children(group.data, me.data?.email ?? "")}</>;
}

/** games is a member's view of the group's games, from the games slice
 * (App puts it in). */
export function Group({ games }: { games?: (id: number) => ReactNode }) {
  const join = useJoin();
  return (
    <GroupFrame>
      {(g, myEmail) => {
        const member = g.how === "member";
        return (
          <main>
            <Link to="/play" className={`${link} text-sm`}>
              ← Spielen
            </Link>
            <div className="mt-1 mb-1 flex items-baseline justify-between gap-3">
              <h1 className="text-2xl font-semibold">{g.name}</h1>
              {member && (
                <Link to={`/groups/${g.id}/settings`} className={`${link} shrink-0 text-sm`}>
                  Verwalten
                </Link>
              )}
            </div>
            <p className="mb-4 text-ink-muted">
              {kindLabel(g.kind)} · {g.members} {g.members === 1 ? "Mitglied" : "Mitglieder"}
              {areaLabel(g.area) && ` · ${areaLabel(g.area)}`}
            </p>

            {member && g.requests.length > 0 && (
              <Link
                to={`/groups/${g.id}/settings`}
                className={`${waits} mb-4 block p-4 font-semibold hover:opacity-90`}
              >
                {g.requests.length === 1
                  ? "Eine Person möchte hinein"
                  : `${g.requests.length} möchten hinein`}{" "}
                <span className="font-normal text-ink-muted">· unter Verwalten</span>
              </Link>
            )}

            {!member && (
              <div className="mb-4">
                {g.requested ? (
                  <p className="text-ink-muted">Du hast gefragt, ob du hinein darfst.</p>
                ) : (
                  <button
                    type="button"
                    className={primary}
                    disabled={join.isPending}
                    onClick={() => join.mutate(g.id)}
                  >
                    {g.how === "invited"
                      ? "Annehmen"
                      : g.kind === "open"
                        ? "Beitreten"
                        : "Anfragen"}
                  </button>
                )}
                {join.isError && (
                  <p role="alert" className="mt-2 text-sm text-danger-text">
                    {errorText(join.error)}
                  </p>
                )}
              </div>
            )}

            {member && games?.(g.id)}
            <Members g={g} me={myEmail} />
          </main>
        );
      }}
    </GroupFrame>
  );
}

/** Verwalten: everything about the group itself, for its members. */
export function GroupSettings() {
  return (
    <GroupFrame>
      {(g, myEmail) =>
        g.how !== "member" ? (
          <main>
            <h1 className="mt-2 mb-2 text-2xl font-semibold">Nur für Mitglieder</h1>
            <p className="mb-4 text-ink-muted">Verwalten kann eine Gruppe nur, wer drin ist.</p>
            <Link to={`/groups/${g.id}`} className={quiet}>
              Zur Gruppe
            </Link>
          </main>
        ) : (
          <main>
            <Link to={`/groups/${g.id}`} className={`${link} text-sm`}>
              ← {g.name}
            </Link>
            <h1 className="mt-1 mb-4 text-2xl font-semibold">Gruppe verwalten</h1>
            <Area g={g} />
            <Members g={g} me={myEmail} manage />
            <Requests g={g} />
            <Invite g={g} me={myEmail} />
            {g.role === "admin" && <Settings g={g} />}
            <Leave g={g} me={myEmail} />
          </main>
        )
      }
    </GroupFrame>
  );
}

const AREAS = [
  ["alle", "Beides"],
  ["halle", "Halle"],
  ["freiluft", "Freiluft"],
] as const;

/** Where the group plays; any member sets it, for the whole group. */
function Area({ g }: { g: G }) {
  const client = useQueryClient();
  const key = useWriteKey();
  const setArea = useMutation({
    mutationFn: (area: string) => {
      const body = { area };
      return call(
        api.PATCH("/api/v1/groups/{groupId}", {
          params: { path: { groupId: g.id }, header: { "Idempotency-Key": key(body) } },
          body,
        }),
      );
    },
    onSuccess: (next) => {
      client.setQueryData(["group", g.id], next);
      void client.invalidateQueries({ queryKey: ["groups"] });
      void client.invalidateQueries({ queryKey: ["fits", g.id] });
    },
  });
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">Wo spielt ihr?</h2>
      <div className="mb-1 flex gap-2" role="group" aria-label="Wo spielt ihr?">
        {AREAS.map(([a, label]) => (
          <button
            key={a}
            type="button"
            aria-pressed={g.area === a}
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(g.area === a)}`}
            disabled={setArea.isPending}
            onClick={() => g.area !== a && setArea.mutate(a)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-muted">
        Gilt für die ganze Gruppe: „Passt für vier“ zeigt nur diese Plätze.
        {g.area === "halle" && " Überdachte Plätze zählen zur Halle."}
      </p>
      {setArea.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(setArea.error)}
        </p>
      )}
    </section>
  );
}

function useRemove(g: G, after?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      call(
        api.DELETE("/api/v1/groups/{groupId}/members/{email}", {
          params: { path: { groupId: g.id, email } },
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["groups"] });
      void client.invalidateQueries({ queryKey: ["group", g.id] });
      after?.();
    },
  });
}

function Members({ g, me, manage = false }: { g: G; me: string; manage?: boolean }) {
  const [asking, setAsking] = useState<string | null>(null);
  const remove = useRemove(g, () => setAsking(null));
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">Mitglieder</h2>
      <ul className={`${card} divide-y divide-line`}>
        {g.memberList.map((m) => (
          <li key={m.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <div className="truncate">
                {m.name || m.email}
                {m.email === me && " (du)"}
                {m.role === "admin" && <span className="ml-2 text-xs text-ink-muted">Admin</span>}
              </div>
              <div className="text-xs text-ink-muted">
                {m.daysEntered === 0
                  ? "hat noch nichts eingetragen"
                  : `${m.daysEntered} von 14 Tagen eingetragen`}
              </div>
            </div>
            {manage &&
              g.role === "admin" &&
              m.email !== me &&
              (asking === m.email ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={danger}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(m.email)}
                  >
                    Entfernen
                  </button>
                  <button type="button" className={quiet} onClick={() => setAsking(null)}>
                    Abbrechen
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${link} shrink-0 text-sm`}
                  onClick={() => setAsking(m.email)}
                >
                  Entfernen …
                </button>
              ))}
          </li>
        ))}
      </ul>
      {remove.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(remove.error)}
        </p>
      )}
    </section>
  );
}

function Requests({ g }: { g: G }) {
  const client = useQueryClient();
  const key = useWriteKey();
  const done = () => {
    void client.invalidateQueries({ queryKey: ["group", g.id] });
  };
  const admit = useMutation({
    mutationFn: (email: string) =>
      call(
        api.PUT("/api/v1/groups/{groupId}/members/{email}", {
          params: { path: { groupId: g.id, email }, header: { "Idempotency-Key": key(email) } },
        }),
      ),
    onSuccess: done,
  });
  const turnDown = useMutation({
    mutationFn: (email: string) =>
      call(
        api.DELETE("/api/v1/groups/{groupId}/requests/{email}", {
          params: { path: { groupId: g.id, email } },
        }),
      ),
    onSuccess: done,
  });
  if (g.requests.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">Möchten hinein</h2>
      <ul className={`${card} divide-y divide-line`}>
        {g.requests.map((r) => (
          <li key={r.email} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate">{r.name || r.email}</span>
            <button
              type="button"
              className={quiet}
              disabled={admit.isPending}
              onClick={() => admit.mutate(r.email)}
            >
              Hereinlassen
            </button>
            <button
              type="button"
              className={`${link} text-sm`}
              disabled={turnDown.isPending}
              onClick={() => turnDown.mutate(r.email)}
            >
              Ablehnen
            </button>
          </li>
        ))}
      </ul>
      {(admit.isError || turnDown.isError) && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(admit.error ?? turnDown.error)}
        </p>
      )}
    </section>
  );
}

function Invite({ g, me }: { g: G; me: string }) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const key = useWriteKey();
  const invite = useMutation({
    mutationFn: (address: string) =>
      call(
        api.POST("/api/v1/groups/{groupId}/invitations", {
          params: { path: { groupId: g.id }, header: { "Idempotency-Key": key(address) } },
          body: { email: address },
        }),
      ),
    onSuccess: (inv) => {
      setEmail("");
      setSent(inv.email);
      void client.invalidateQueries({ queryKey: ["group", g.id] });
    },
  });
  const drop = useDropInvitation();
  return (
    <section className="mb-6">
      <h2 className="mb-1 font-semibold">Einladen</h2>
      <p className="mb-2 text-sm text-ink-muted">
        Wer eingeladen ist, kommt auch in die App und sieht die Gruppe. Die Person meldet sich auf
        padel.burgstaller.me mit dieser E-Mail an.
      </p>
      <form
        className="mb-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite.mutate(email.trim());
        }}
      >
        <label className="sr-only" htmlFor="group-invite">
          E-Mail-Adresse
        </label>
        <input
          id="group-invite"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="name@example.at"
          className={`${field} min-w-0 flex-1`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          className={quiet}
          disabled={!email.trim() || invite.isPending}
          aria-busy={invite.isPending}
        >
          {invite.isPending ? "Lädt ein …" : "Einladen"}
        </button>
      </form>
      {invite.isError && (
        <p role="alert" className="mb-2 text-sm text-danger-text">
          {errorText(invite.error)}
        </p>
      )}
      {sent && !invite.isError && (
        <p role="status" className="mb-2 text-sm text-success-text">
          {sent} ist eingeladen. Schick ihr oder ihm den Link https://padel.burgstaller.me.
        </p>
      )}
      {g.invitations.length > 0 && (
        <ul className={`${card} divide-y divide-line`}>
          {g.invitations.map((i) => (
            <li key={i.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate">{i.email}</div>
                <div className="text-xs text-ink-muted">
                  eingeladen{i.invitedBy === me ? " von dir" : ""}, noch nicht angenommen
                </div>
              </div>
              {(i.invitedBy === me || g.role === "admin") && (
                <button
                  type="button"
                  className={`${link} shrink-0 text-sm`}
                  disabled={drop.isPending}
                  onClick={() => drop.mutate({ id: g.id, email: i.email })}
                >
                  Zurücknehmen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {drop.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(drop.error)}
        </p>
      )}
    </section>
  );
}

function Settings({ g }: { g: G }) {
  const client = useQueryClient();
  const [name, setName] = useState(g.name);
  const key = useWriteKey();
  const update = useMutation({
    mutationFn: (body: { name?: string; kind?: string }) =>
      call(
        api.PATCH("/api/v1/groups/{groupId}", {
          params: { path: { groupId: g.id }, header: { "Idempotency-Key": key(body) } },
          body,
        }),
      ),
    onSuccess: (next) => {
      client.setQueryData(["group", g.id], next);
      void client.invalidateQueries({ queryKey: ["groups"] });
    },
  });
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">Name und wer hinein kann</h2>
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== g.name) update.mutate({ name: name.trim() });
        }}
      >
        <label className="sr-only" htmlFor="rename">
          Name der Gruppe
        </label>
        <input
          id="rename"
          className={`${field} min-w-0 flex-1`}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          className={quiet}
          disabled={!name.trim() || name.trim() === g.name || update.isPending}
        >
          Umbenennen
        </button>
      </form>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Wer kann hinein?">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={g.kind === k.kind}
            title={k.hint}
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(g.kind === k.kind)}`}
            disabled={update.isPending}
            onClick={() => g.kind !== k.kind && update.mutate({ kind: k.kind })}
          >
            {k.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{KINDS.find((k) => k.kind === g.kind)?.hint}</p>
      {update.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(update.error)}
        </p>
      )}
    </section>
  );
}

function Leave({ g, me }: { g: G; me: string }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const leave = useRemove(g, () => navigate("/play"));
  const last = g.members === 1;
  return (
    <section className="mb-6 border-t border-line pt-4">
      {asking ? (
        <div>
          <p className="mb-2">
            {last
              ? "Du bist als Letzte oder Letzter drin. Die Gruppe und ihre Einladungen verschwinden dann."
              : "Wirklich hinaus? Wieder hinein kommst du nur mit Einladung oder wenn die Gruppe offen ist."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={danger}
              disabled={leave.isPending || !me}
              onClick={() => leave.mutate(me)}
            >
              Verlassen
            </button>
            <button type="button" className={quiet} onClick={() => setAsking(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${link} text-sm`} onClick={() => setAsking(true)}>
          Gruppe verlassen …
        </button>
      )}
      {leave.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(leave.error)}
        </p>
      )}
    </section>
  );
}
