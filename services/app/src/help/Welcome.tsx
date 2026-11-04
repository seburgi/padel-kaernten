// Willkommen (docs/design/help.md): what someone new sees once, whatever
// address they opened: what the app is, their name, three steps to a
// first game, and the way to the Hilfe. "Los geht's" records it and goes
// on to the address they came for (?next=), or to Spielen, where their
// invitations wait, when they only opened the app's address; "Alles erklärt"
// records it too and opens the Hilfe. A group invitation waits on top, to
// accept right there (Seb, 2026-11-04): someone new who goes no further
// than this page is in the group all the same.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, call, newKey, useWriteKey, type Me } from "../api/client";
import { card, field, link, primary } from "../ui";
import { Picture } from "./Help";
import type { Shot } from "./chapters";

const STEPS: { title: string; text: string; shot: Shot }[] = [
  {
    title: "Sag, wann du kannst",
    text: "Unter „Wann kann ich?“: für die nächsten zwei Wochen, in halben Stunden. Deine Gruppen sehen es.",
    shot: { name: "zeiten", alt: "Wann kannst du?: die nächsten Tage mit eingetragenen Zeiten." },
  },
  {
    title: "Spiel in einer Gruppe",
    text: "Nimm eine Einladung an, tritt unter „Gruppen finden“ einer bei, oder gründe eine und lade Leute ein.",
    shot: {
      name: "gruppen-finden",
      alt: "Gruppen finden: eine Gruppe auf Anfrage und eine offene.",
    },
  },
  {
    title: "Zu viert spielen",
    text: "„Passt für vier“ zeigt, wann vier von euch können und ein Platz frei ist. Eine Person schlägt vor, bucht bei der Anlage und tippt „Gebucht“.",
    shot: {
      name: "spiele-passt",
      alt: "Wann passt es für vier?: passende Zeiten mit Anlage und Preis pro Kopf.",
    },
  },
];

/**
 * A path in this app to go on to, never another site. Someone who opened only
 * the app's address goes to Spielen: an invitation waits there, not on Plätze.
 */
function nextPath(next: string | null): string {
  return next &&
    next !== "/" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/welcome")
    ? next
    : "/play";
}

/** onWelcome marks what is new as read: someone new has nothing to catch up on. */
export function Welcome({ onWelcome }: { onWelcome: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => call(api.GET("/api/v1/me")),
    retry: false,
  });
  const [name, setName] = useState("");
  const [keys] = useState(() => ({ name: newKey(), welcomed: newKey() }));
  const asked = me.data?.name === "";
  const invited = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await call(api.GET("/api/v1/groups"))).items,
    retry: false,
  });
  const joinKey = useWriteKey();
  const [joined, setJoined] = useState<number[]>([]);
  const join = useMutation({
    mutationFn: (id: number) =>
      call(
        api.POST("/api/v1/groups/{groupId}/join", {
          params: { path: { groupId: id }, header: { "Idempotency-Key": joinKey(id) } },
        }),
      ),
    onSuccess: (_, id) => {
      setJoined((j) => [...j, id]);
      void client.invalidateQueries({ queryKey: ["groups"] });
      void client.invalidateQueries({ queryKey: ["group", id] });
    },
  });
  const invitations = (invited.data ?? []).filter(
    (g) => g.how === "invited" || joined.includes(g.id),
  );

  const go = useMutation({
    mutationFn: async (_to: string) => {
      let out: Me | undefined = me.data;
      if (asked && name.trim())
        out = await call(
          api.PUT("/api/v1/me/name", {
            params: { header: { "Idempotency-Key": keys.name } },
            body: { name: name.trim() },
          }),
        );
      if (!out?.welcomed)
        out = await call(
          api.POST("/api/v1/me/welcomed", {
            params: { header: { "Idempotency-Key": keys.welcomed } },
          }),
        );
      return out;
    },
    onSuccess: (out, to) => {
      if (out) client.setQueryData(["me"], out);
      onWelcome();
      void navigate(to, { replace: true });
    },
  });

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Willkommen bei Padel Kärnten</h1>
      <p className="mb-5 text-ink-muted">
        Hier siehst du, wo in Kärnten ein Padelplatz frei ist, und findest mit deinen Leuten eine
        Zeit für ein Spiel zu viert. Die App ist privat und kostet nichts; gebucht wird bei der
        Anlage.
      </p>

      {invitations.length > 0 && (
        <section className={`${card} mb-5 p-4`} aria-labelledby="welcome-invited">
          <h2 id="welcome-invited" className="mb-1 font-semibold">
            Du bist eingeladen
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            Nimm an, dann siehst du, wann die anderen können, und sie sehen dich.
          </p>
          <ul className="space-y-2">
            {invitations.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-sm text-ink-muted">
                    {" "}
                    · {g.members} {g.members === 1 ? "Person" : "Leute"}
                  </span>
                </span>
                {joined.includes(g.id) ? (
                  <span role="status" className="text-sm text-success-text">
                    Du bist drin.
                  </span>
                ) : (
                  <button
                    type="button"
                    className={primary}
                    disabled={join.isPending}
                    onClick={() => join.mutate(g.id)}
                  >
                    Annehmen
                  </button>
                )}
              </li>
            ))}
          </ul>
          {join.isError && (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              Das hat nicht geklappt. Versuch es bitte nochmal.
            </p>
          )}
        </section>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go.mutate(nextPath(params.get("next")));
        }}
      >
        {asked && (
          <div className={`${card} mb-5 p-4`}>
            <label htmlFor="welcome-name" className="mb-1 block font-semibold">
              Wie sollen dich die anderen sehen?
            </label>
            <p className="mb-2 text-sm text-ink-muted">
              Ohne Namen sehen sie deine E-Mail-Adresse.
            </p>
            <input
              id="welcome-name"
              className={`${field} w-full`}
              placeholder="Vorname"
              maxLength={40}
              autoComplete="given-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <h2 className="mb-3 font-semibold">So kommst du zum ersten Spiel</h2>
        <ol className="mb-5 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle font-mono text-sm font-semibold text-accent-text"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mb-2 text-ink-secondary">{s.text}</p>
                <Picture shot={s.shot} crop />
              </div>
            </li>
          ))}
        </ol>

        <p className="mb-5 text-sm text-ink-muted">
          Am Handy: Leg Padel Kärnten auf den Home-Bildschirm. Dann öffnet es sich wie eine App, und
          am iPhone kann es dir erst dann Bescheid sagen, wenn jemand ein Spiel vorschlägt.
        </p>

        <div className="mb-8 flex flex-wrap items-center gap-4">
          <button type="submit" className={primary} disabled={go.isPending || !me.data}>
            Los geht’s
          </button>
          <button
            type="button"
            className={`${link} inline-flex py-2`}
            disabled={go.isPending || !me.data}
            onClick={() => go.mutate("/help")}
          >
            Alles erklärt
          </button>
        </div>
        {go.isError && (
          <p role="alert" className="-mt-6 mb-8 text-sm text-danger-text">
            Das hat nicht geklappt. Versuch es bitte nochmal.
          </p>
        )}
      </form>
    </main>
  );
}
