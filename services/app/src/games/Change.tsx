// Changing a game afterwards (docs/design/games.md, Seb 2026-11-18): whoever
// proposed it opens "Ändern" on the game and moves it to another time, venue
// or court, takes someone out, or cancels it with a reason. A new time or
// venue asks whoever was in again; their places stay theirs until they
// answer. Whether someone would have time is only shown, from what they
// entered in "Wann kann ich?"; the app never enters times for anyone.
import { Sheet } from "@burgstaller/web/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, call, useWriteKey, type Game, type Move } from "../api/client";
import type { components } from "../api/schema";
import { card, danger, field, link, pressed, primary, quiet, waits } from "../ui";
import { Durations, DURATIONS, type Duration } from "./Durations";
import { byTime, dayLabel, errorText, euros, names, reserves, shown, span } from "./games";

type Person = { email: string; name: string };
type Days = {
  email: string;
  days: { day: string; spans: { from: number; to: number }[]; declined: boolean }[];
}[];
type Change = components["schemas"]["GameChange"];

/** How long a note to the others may be (games.MaxNote). */
export const MAX_NOTE = 140;

export type Step = "menu" | "move" | "players" | "cancel" | null;

/** The places held: those in and those asked again after a move. */
const holding = (g: Game) => g.lineup.filter((p) => p.state === "in" || p.state === "asked");

/** A change to the game, once per Idempotency-Key; done gets the game after. */
function useChange(g: Game, done: (g: Game) => void) {
  const key = useWriteKey();
  return useMutation({
    mutationFn: (body: Change) =>
      call(
        api.PATCH("/api/v1/games/{gameId}", {
          params: { path: { gameId: g.id }, header: { "Idempotency-Key": key(body) } },
          body,
        }),
      ),
    onSuccess: done,
  });
}

/** The sheets, one after the other: what to change, then how. */
export function ChangeSheets({
  g,
  step,
  setStep,
  times,
  done,
}: {
  g: Game;
  step: Step;
  setStep: (s: Step) => void;
  times?: Days;
  done: (g: Game) => void;
}) {
  const close = () => setStep(null);
  const finish = (next: Game) => {
    done(next);
    close();
  };
  if (step === "menu") return <Menu g={g} setStep={setStep} />;
  if (step === "move") return <MoveSheet g={g} times={times} onClose={close} done={finish} />;
  if (step === "players") return <Players g={g} onClose={close} done={done} />;
  if (step === "cancel") return <Cancel g={g} onClose={close} done={finish} />;
  return null;
}

function Row({
  title,
  note,
  onClick,
  tone,
}: {
  title: string;
  note: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover"
      >
        <span className="min-w-0">
          <span className={`block font-semibold ${tone === "danger" ? "text-danger-text" : ""}`}>
            {title}
          </span>
          <span className="block text-sm text-ink-muted">{note}</span>
        </span>
        <span aria-hidden="true" className="text-ink-faint">
          ›
        </span>
      </button>
    </li>
  );
}

function Menu({ g, setStep }: { g: Game; setStep: (s: Step) => void }) {
  const held = holding(g);
  return (
    <Sheet label="Spiel ändern" wide="dialog" onClose={() => setStep(null)}>
      <h2 className="font-semibold">Spiel ändern</h2>
      <p className="mb-3 text-sm text-ink-muted">
        {dayLabel(g.day)}, {span(g.start, g.minutes)} · {g.venueName} · {g.court}
      </p>
      <ul className={`${card} mb-3 shrink-0 divide-y divide-line overflow-hidden`}>
        <Row
          title="Zeit oder Ort ändern"
          note={
            g.courtTaken
              ? "Der Platz ist nicht mehr frei"
              : "Anderer Tag, andere Zeit, anderer Platz"
          }
          onClick={() => setStep("move")}
        />
        <Row
          title="Spieler"
          note={`${held.length} von ${g.players} Plätzen vergeben · jemanden herausnehmen`}
          onClick={() => setStep("players")}
        />
        <Row
          title="Spiel absagen"
          note="Alle, die dabei sind, bekommen Bescheid"
          tone="danger"
          onClick={() => setStep("cancel")}
        />
      </ul>
      <p className="text-sm text-ink-muted">
        Die Plätze (2 bis 8) stellst du wie bisher direkt beim Spiel ein.
      </p>
    </Sheet>
  );
}

const duration = (n: number): Duration =>
  (DURATIONS as readonly number[]).includes(n) ? (n as Duration) : 90;

function MoveSheet({
  g,
  times,
  onClose,
  done,
}: {
  g: Game;
  times?: Days;
  onClose: () => void;
  done: (g: Game) => void;
}) {
  const [minutes, setMinutes] = useState<Duration>(duration(g.minutes));
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<Move | null>(null);
  const moves = useQuery({
    queryKey: ["moves", g.id, minutes],
    queryFn: () =>
      call(
        api.GET("/api/v1/games/{gameId}/moves", {
          params: { path: { gameId: g.id }, query: { minutes } },
        }),
      ),
    retry: false,
  });
  if (picked)
    return (
      <Confirm
        g={g}
        m={picked}
        times={times}
        onBack={() => setPicked(null)}
        onClose={onClose}
        done={done}
        stale={() => {
          setPicked(null);
          void moves.refetch();
        }}
      />
    );
  const all = moves.data?.moves ?? [];
  const days = [...new Set(all.map((m) => m.day))];
  const shownDay = day && days.includes(day) ? day : days.includes(g.day) ? g.day : days[0];
  const here = (m: Move) =>
    m.day === g.day && m.start === g.start && m.minutes === g.minutes && m.venueId === g.venueId;
  const swap = all.filter(here);
  const list = all.filter((m) => m.day === shownDay && !here(m));
  const others = holding(g).filter((p) => p.email !== g.proposedBy.email);
  return (
    <Sheet label="Zeit oder Ort ändern" wide="dialog" onClose={onClose}>
      <h2 className="font-semibold">Zeit oder Ort ändern</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Freie Plätze laut den neuesten Platzdaten, und wer von euch laut „Wann kann ich?“ Zeit
        hätte.
      </p>
      {moves.isPending && (
        <div
          aria-busy="true"
          aria-label="Lädt"
          className="h-32 shrink-0 animate-skeleton rounded-2xl bg-sunken"
        />
      )}
      {moves.isError && (
        <p role="alert" className="mb-3 text-sm">
          {errorText(moves.error)}{" "}
          <button type="button" className={link} onClick={() => void moves.refetch()}>
            Nochmal versuchen
          </button>
        </p>
      )}
      {swap.length > 0 && (
        <section className="mb-4 shrink-0">
          <h3 className="mb-1 text-sm font-semibold">Gleiche Zeit, anderer Platz</h3>
          <ul className={`${card} divide-y divide-line overflow-hidden`}>
            {swap.map((m) => (
              <Option key={m.court} m={m} others={others} times={times} onPick={setPicked} keep />
            ))}
          </ul>
        </section>
      )}
      <h3 className="text-sm font-semibold">Andere Zeit</h3>
      <p className="mb-2 text-[13px] text-ink-muted">
        ✓ hätte Zeit · ? nichts eingetragen · durchgestrichen: kann nicht
      </p>
      <Durations minutes={minutes} onChange={setMinutes} className="mb-2 shrink-0" />
      {days.length > 0 && (
        <div
          className="mb-2 flex shrink-0 gap-1.5 overflow-x-auto pb-1"
          data-no-pull
          role="group"
          aria-label="Tag"
        >
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === shownDay}
              onClick={() => setDay(d)}
              className={`h-9 shrink-0 rounded-full border px-3 text-sm font-semibold ${pressed(d === shownDay)}`}
            >
              {dayLabel(d)}
            </button>
          ))}
        </div>
      )}
      {moves.isSuccess && (
        <ul className={`${card} shrink-0 divide-y divide-line overflow-hidden`}>
          {list.map((m) => (
            <Option
              key={`${m.start}-${m.venueId}-${m.court}`}
              m={m}
              others={others}
              times={times}
              onPick={setPicked}
            />
          ))}
          {list.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">
              {days.length === 0
                ? "In den nächsten Tagen ist kein Platz für so lange frei."
                : "An diesem Tag ist nichts mehr frei."}
            </li>
          )}
        </ul>
      )}
      <p className="mt-2 text-sm text-ink-muted">
        Tage, an denen eure Gruppe schon ein Spiel hat, fehlen hier.
      </p>
    </Sheet>
  );
}

function Option({
  m,
  others,
  times,
  onPick,
  keep = false,
}: {
  m: Move;
  others: Person[];
  times?: Days;
  onPick: (m: Move) => void;
  keep?: boolean;
}) {
  const t = byTime(m, others, times);
  const all = others.length > 0 && t.free.length === others.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(m)}
        aria-label={`${dayLabel(m.day)} ${span(m.start, m.minutes)}, ${m.venueName}, ${m.court}`}
        className="block w-full px-4 py-2.5 text-left hover:bg-hover"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{keep ? m.court : span(m.start, m.minutes)}</span>
          <span className="shrink-0 text-sm text-ink-muted">
            {m.perHead && `${euros(m.perHead.amount)} pro Kopf`}
          </span>
        </span>
        <span className="block text-sm text-ink-muted">
          {keep ? m.venueName : `${m.venueName} · ${m.court}`}
        </span>
        {keep ? (
          <span className="mt-1 block text-sm font-semibold text-accent-text">
            Alle bleiben dabei
          </span>
        ) : (
          others.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {others.map((p) => {
                const free = t.free.includes(p);
                const busy = t.busy.includes(p);
                return (
                  <span
                    key={p.email}
                    className={`rounded-full border px-2 text-[13px] font-semibold ${
                      free
                        ? "border-accent bg-accent text-accent-ink"
                        : busy
                          ? "border-line text-ink-faint line-through"
                          : "border-dashed border-ink-faint text-ink-muted"
                    }`}
                  >
                    {free ? "✓ " : busy ? "" : "? "}
                    {shown(p)}
                  </span>
                );
              })}
              {all && (
                <span className="text-[13px] font-semibold text-accent-text">Alle hätten Zeit</span>
              )}
            </span>
          )
        )}
      </button>
    </li>
  );
}

function Confirm({
  g,
  m,
  times,
  onBack,
  onClose,
  done,
  stale,
}: {
  g: Game;
  m: Move;
  times?: Days;
  onBack: () => void;
  onClose: () => void;
  done: (g: Game) => void;
  /** The court went meanwhile: back to a fresh list. */
  stale: () => void;
}) {
  const [note, setNote] = useState("");
  const change = useChange(g, done);
  const others = holding(g).filter((p) => p.email !== g.proposedBy.email);
  const res = reserves(g);
  const outs = g.lineup.filter((p) => p.state === "out");
  const courtOnly =
    m.day === g.day && m.start === g.start && m.minutes === g.minutes && m.venueId === g.venueId;
  const t = byTime(m, others, times);
  const label = (p: Person) =>
    t.free.includes(p)
      ? "hätte Zeit"
      : t.busy.includes(p)
        ? "laut „Wann kann ich?“ nicht frei"
        : "nichts eingetragen";
  const told = courtOnly ? [...holding(g), ...res] : [...others, ...res, ...outs];
  const send = () =>
    change.mutate(
      {
        move: {
          venueId: m.venueId,
          court: m.court,
          day: m.day,
          start: m.start,
          minutes: m.minutes,
        },
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      { onError: (e) => e instanceof ApiError && e.kind === "court-gone" && stale() },
    );
  return (
    <Sheet
      label={courtOnly ? "Platz wechseln" : "Spiel verschieben"}
      wide="dialog"
      onClose={onClose}
    >
      <h2 className="font-semibold">{courtOnly ? "Platz wechseln?" : "Spiel verschieben?"}</h2>
      <dl className={`${card} my-3 shrink-0 divide-y divide-line text-sm`}>
        <div className="flex gap-3 px-4 py-2">
          <dt className="w-12 shrink-0 text-ink-muted">Bisher</dt>
          <dd className="text-ink-muted line-through">
            {dayLabel(g.day)}, {span(g.start, g.minutes)} · {g.venueName} · {g.court}
          </dd>
        </div>
        <div className="flex gap-3 px-4 py-2">
          <dt className="w-12 shrink-0 font-semibold">Neu</dt>
          <dd>
            <span className="font-semibold">
              {dayLabel(m.day)}, {span(m.start, m.minutes)}
            </span>{" "}
            · {m.venueName} · {m.court}
            {m.perHead && (
              <span className="text-ink-muted"> · {euros(m.perHead.amount)} pro Kopf</span>
            )}
          </dd>
        </div>
      </dl>

      {courtOnly ? (
        <p className="mb-3 text-sm">
          Zeit und Anlage bleiben gleich, also bleiben alle dabei und müssen nicht neu zusagen.
        </p>
      ) : (
        others.length > 0 && (
          <>
            <h3 className="text-sm font-semibold">Neu zusagen</h3>
            <p className="mb-2 text-sm text-ink-muted">
              Ihre Plätze bleiben frei, bis sie antworten.
            </p>
            <ul className={`${card} mb-3 shrink-0 divide-y divide-line`}>
              {others.map((p) => (
                <li
                  key={p.email}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <span className="font-semibold">{shown(p)}</span>
                  <span className={t.free.includes(p) ? "text-accent-text" : "text-ink-muted"}>
                    {label(p)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )
      )}
      {!courtOnly && outs.length > 0 && (
        <p className="mb-3 text-sm text-ink-muted">
          {names(outs)} {outs.length === 1 ? "konnte" : "konnten"} zur alten Zeit nicht und{" "}
          {outs.length === 1 ? "wird" : "werden"} neu gefragt.
        </p>
      )}
      {g.state === "booked" && !courtOnly && (
        <div className={`${waits} mb-3 shrink-0 p-3 text-sm`}>
          <p className="font-semibold text-warning-text">Du hast schon gebucht</p>
          <p>
            Storniere die alte Buchung bei {g.venueName} selbst und buche die neue Zeit danach.
            {g.code && " Der Zugangscode der alten Buchung wird gelöscht."}
          </p>
        </div>
      )}

      <label className="mb-1 block text-sm font-semibold" htmlFor="change-note">
        Nachricht an alle <span className="font-normal text-ink-muted">(optional)</span>
      </label>
      <input
        id="change-note"
        className={`${field} mb-3 w-full shrink-0`}
        maxLength={MAX_NOTE}
        value={note}
        placeholder={
          courtOnly
            ? "Zum Beispiel: Court 1 ist leider weg"
            : "Zum Beispiel: Sorry, der Platz war weg"
        }
        onChange={(e) => setNote(e.target.value)}
      />
      {told.length > 0 && (
        <p className="mb-2 text-sm text-ink-muted">
          {names(told.filter((p) => p.email !== g.proposedBy.email))}{" "}
          {told.filter((p) => p.email !== g.proposedBy.email).length === 1 ? "bekommt" : "bekommen"}{" "}
          eine Mitteilung.
          {!courtOnly &&
            res.length > 0 &&
            ` ${names(res)} ${res.length === 1 ? "bleibt" : "bleiben"} Ersatz.`}
        </p>
      )}
      {change.isError && (
        <p role="alert" className="mb-2 text-sm text-danger-text">
          {errorText(change.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${primary} flex-1`}
          disabled={change.isPending}
          onClick={send}
        >
          {courtOnly ? "Platz wechseln" : "Verschieben"}
        </button>
        <button type="button" className={quiet} onClick={onBack}>
          Zurück
        </button>
      </div>
    </Sheet>
  );
}

function Players({ g, onClose, done }: { g: Game; onClose: () => void; done: (g: Game) => void }) {
  const [out, setOut] = useState<string | null>(null);
  const change = useChange(g, (next) => {
    setOut(null);
    done(next);
  });
  const held = holding(g);
  const res = reserves(g);
  const who = [...held, ...res].find((p) => p.email === out);
  const row = (p: Person, note?: string) => (
    <li key={p.email} className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="min-w-0">
        {shown(p)}
        {p.email === g.proposedBy.email && <span className="text-ink-muted"> (du)</span>}
        {note && <span className="text-sm text-ink-muted"> · {note}</span>}
      </span>
      {p.email !== g.proposedBy.email && (
        <button
          type="button"
          className={`${link} text-sm`}
          aria-label={`${shown(p)} herausnehmen`}
          onClick={() => setOut(p.email)}
        >
          Herausnehmen
        </button>
      )}
    </li>
  );
  return (
    <Sheet label="Spieler" wide="dialog" onClose={onClose}>
      <h2 className="font-semibold">Spieler</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Für jemanden, der dir gesagt hat, dass er doch nicht kann. Wer herausgenommen wird, bekommt
        eine Mitteilung.
      </p>
      <ul className={`${card} mb-3 shrink-0 divide-y divide-line`}>
        {held.map((p) => row(p, p.state === "asked" ? "neu gefragt" : undefined))}
        {res.map((p) => row(p, "Ersatz"))}
      </ul>
      {who && (
        <div className={`${waits} mb-3 shrink-0 p-3 text-sm`}>
          <p className="mb-1 font-semibold">{shown(who)} herausnehmen?</p>
          <p className="mb-3">
            {who.state === "reserve"
              ? "Sie oder er wartet dann nicht mehr auf einen Platz."
              : res[0]
                ? `${shown(res[0])} rückt als Ersatz nach und bekommt Bescheid.`
                : "Der Platz wird frei, und die Gruppe sieht wieder, dass jemand gesucht wird."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={danger}
              disabled={change.isPending}
              onClick={() => change.mutate({ remove: who.email })}
            >
              Herausnehmen
            </button>
            <button type="button" className={quiet} onClick={() => setOut(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {change.isError && (
        <p role="alert" className="text-sm text-danger-text">
          {errorText(change.error)}
        </p>
      )}
    </Sheet>
  );
}

const REASONS = ["Zu wenige", "Platz ausgebucht", "Etwas kam dazwischen", "Wetter"];

function Cancel({ g, onClose, done }: { g: Game; onClose: () => void; done: (g: Game) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const change = useChange(g, done);
  const told = g.lineup.filter((p) => p.state !== "out" && p.email !== g.proposedBy.email);
  const note = own.trim() || reason || "";
  return (
    <Sheet label="Spiel absagen" wide="dialog" onClose={onClose}>
      <h2 className="font-semibold">Spiel absagen?</h2>
      <p className="mb-3 text-sm text-ink-muted">
        {dayLabel(g.day)}, {span(g.start, g.minutes)} · {g.venueName}
      </p>
      <p className="mb-1 text-sm font-semibold">
        Warum?{" "}
        <span className="font-normal text-ink-muted">(optional, steht in der Mitteilung)</span>
      </p>
      <div className="mb-2 flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Grund">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === reason}
            onClick={() => setReason(r === reason ? null : r)}
            className={`h-9 rounded-full border px-3 text-sm font-semibold ${pressed(r === reason)}`}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        aria-label="Grund in eigenen Worten"
        className={`${field} mb-3 w-full shrink-0`}
        maxLength={MAX_NOTE}
        value={own}
        placeholder="Oder in eigenen Worten …"
        onChange={(e) => setOwn(e.target.value)}
      />
      {told.length > 0 && (
        <p className="mb-3 text-sm">
          <span className="font-semibold">Bescheid bekommen:</span> {names(told)}
        </p>
      )}
      {g.state === "booked" && (
        <div className={`${waits} mb-3 shrink-0 p-3 text-sm`}>
          <p className="font-semibold text-warning-text">Du hast schon gebucht</p>
          <p>Storniere die Buchung bei {g.venueName} selbst.</p>
        </div>
      )}
      {change.isError && (
        <p role="alert" className="mb-2 text-sm text-danger-text">
          {errorText(change.error)}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={`${danger} flex-1`}
          disabled={change.isPending}
          onClick={() => change.mutate({ state: "cancelled", ...(note ? { note } : {}) })}
        >
          Spiel absagen
        </button>
        <button type="button" className={quiet} onClick={onClose}>
          Doch nicht
        </button>
      </div>
    </Sheet>
  );
}

/** What the others see on a game after it moved; for whoever was asked
 * again, with Passt mir and Kann nicht. */
export function MovedNote({
  g,
  asked,
  proposer,
  busy,
  answer,
}: {
  g: Game;
  asked: boolean;
  proposer: boolean;
  busy: boolean;
  answer: (a: "in" | "out") => void;
}) {
  const b = g.change;
  if (!b || g.state === "cancelled") return null;
  const courtOnly = b.day === g.day && b.start === g.start && b.venueName === g.venueName;
  return (
    <div role="status" className={`${waits} mt-3 p-4 text-sm`}>
      <p className="mb-1 font-semibold text-warning-text">
        {proposer ? "Du hast" : `${shown(g.proposedBy)} hat`}{" "}
        {courtOnly ? "den Platz gewechselt" : "das Spiel verschoben"}
      </p>
      <p className="text-ink-muted">
        Vorher:{" "}
        <span className="line-through">
          {courtOnly
            ? b.court
            : `${dayLabel(b.day)}, ${span(b.start, b.minutes)} · ${b.venueName === g.venueName ? "" : `${b.venueName} · `}${b.court}`}
        </span>
      </p>
      {b.note && <p className="mt-1">„{b.note}“</p>}
      {asked && (
        <>
          <p className="mt-2 font-semibold">Passt dir die neue Zeit?</p>
          <p className="mb-3 text-ink-muted">Dein Platz bleibt für dich frei, bis du antwortest.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${primary} flex-1`}
              disabled={busy}
              onClick={() => answer("in")}
            >
              Passt mir
            </button>
            <button
              type="button"
              className={`${quiet} flex-1`}
              disabled={busy}
              onClick={() => answer("out")}
            >
              Kann nicht
            </button>
          </div>
        </>
      )}
    </div>
  );
}
