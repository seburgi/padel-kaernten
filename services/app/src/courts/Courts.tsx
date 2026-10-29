// The courts screen: pick a day, a window and how long to play, and see
// which venues have a court free for the whole game (docs/design/slots.md).
// For someone in a group, a start time opens ask (from the games slice; App
// puts it in) to propose it to the group, instead of the venue's page.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Venue } from "../api/client";
import { card, field, link, pressed, quiet } from "../ui";
import {
  AREA_LABEL,
  bookingLink,
  dayLabel,
  DURATIONS,
  euro,
  fit,
  fromHash,
  hm,
  mapLink,
  search,
  standLabel,
  toHash,
  upcoming,
  viennaNow,
  type Area,
  type Hit,
  type Search,
} from "./search";
import { useSnapshot } from "./useSnapshot";

const FROM_TIMES = Array.from({ length: 35 }, (_, i) => 360 + i * 30); // 06:00 to 23:00
const TO_TIMES = Array.from({ length: 35 }, (_, i) => 420 + i * 30); // 07:00 to 24:00

/** One free start time, as a tap on it hands it on. */
export type Slot = {
  venueId: string;
  venueName: string;
  court: string;
  day: string;
  start: number;
  minutes: number;
  href: string;
};

export function Courts({ ask }: { ask?: (slot: Slot, close: () => void) => ReactNode }) {
  const { snapshot, loading, loadFailed, refreshing, refreshFailed, nextAt, refreshNow, retry } =
    useSnapshot();
  const [now, setNow] = useState(() => viennaNow());

  // Today's start times run out: look again on coming back.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setNow(viennaNow());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (loading) return <Skeleton />;
  if (loadFailed || (!snapshot && refreshFailed)) {
    return (
      <Failed
        text={
          loadFailed
            ? "Die freien Plätze konnten nicht geladen werden."
            : "Die Buchungsseiten antworten gerade nicht."
        }
        retry={retry}
      />
    );
  }
  if (!snapshot) return <Skeleton />;
  return (
    <Found
      ask={ask}
      venues={snapshot.venues}
      days={upcoming(snapshot.days, now.date)}
      now={now}
      stand={
        <p
          aria-live="polite"
          className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted"
        >
          <span>{standLabel(snapshot.takenAt)}</span>
          {refreshing ? (
            <span>· wird aktualisiert …</span>
          ) : refreshFailed ? (
            <span>
              · Aktualisieren hat nicht geklappt.{" "}
              <button type="button" className={link} onClick={retry}>
                Nochmal versuchen
              </button>
            </span>
          ) : nextAt ? (
            <span>· aktuell, wieder abfragen ab {clock(nextAt)}</span>
          ) : (
            <button
              type="button"
              className={`${link} pointer-coarse:min-h-(--size-control-touch)`}
              onClick={refreshNow}
            >
              Aktualisieren
            </button>
          )}
        </p>
      }
    />
  );
}

/** "18:10" in Vienna. */
function clock(t: Date): string {
  return t.toLocaleTimeString("de-AT", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Found({
  ask,
  venues,
  days,
  now,
  stand,
}: {
  ask?: (slot: Slot, close: () => void) => ReactNode;
  venues: Venue[];
  days: string[];
  now: { date: string; minute: number };
  stand: React.ReactNode;
}) {
  const [s, setS] = useState<Search>(() => fromHash(location.hash, days, now));
  const [picked, setPicked] = useState<Slot | null>(null);
  useEffect(() => {
    try {
      history.replaceState(null, "", toHash(s));
    } catch {
      // Some browsers limit how often the address may change; the search stays.
    }
  }, [s]);
  useEffect(() => {
    const onHash = () => setS(fromHash(location.hash, days, now));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [days, now]);
  const update = (patch: Partial<Search>) => setS((old) => fit({ ...old, ...patch }));
  const result = useMemo(() => search(venues, s, now), [venues, s, now]);
  const total = result.hits.length + result.bookedOut.length;
  const next = days[days.indexOf(s.day) + 1];

  return (
    <>
      <section aria-label="Suche" className="border-b border-line pb-3">
        <div
          role="group"
          aria-label="Tag"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        >
          {days.map((d) => {
            const l = dayLabel(d, now.date);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={d === s.day}
                onClick={() => update({ day: d })}
                className={`min-w-16 shrink-0 rounded-xl border px-3 py-1.5 text-center text-sm pointer-coarse:min-h-(--size-control-touch) ${pressed(d === s.day)}`}
              >
                {l.top}
                <small className="block text-xs opacity-80">{l.sub}</small>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Beginn ab
            <select
              className={field}
              value={s.from}
              onChange={(e) => update({ from: Number(e.target.value) })}
            >
              {FROM_TIMES.map((m) => (
                <option key={m} value={m}>
                  {hm(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Ende bis
            <select
              className={field}
              value={s.to}
              onChange={(e) => update({ to: Number(e.target.value) })}
            >
              {TO_TIMES.map((m) => (
                <option key={m} value={m}>
                  {hm(m)}
                </option>
              ))}
            </select>
          </label>
          <Segments
            label="Spieldauer"
            value={s.duration}
            options={DURATIONS.map((d) => [d, d === 60 ? "1 h" : d === 90 ? "1,5 h" : "2 h"])}
            onChange={(duration) => update({ duration })}
          />
          <Segments<Area>
            label="Plätze"
            value={s.area}
            options={[
              ["alle", "Alle"],
              ["halle", "Halle"],
              ["freiluft", "Freiluft"],
            ]}
            onChange={(area) => update({ area })}
          />
        </div>
        {stand}
      </section>

      <main aria-live="polite">
        <p className="mt-4 mb-2 font-semibold">
          {result.hits.length
            ? `${result.hits.length} von ${total} Anlagen haben was frei`
            : "Nichts frei"}
          <span className="font-normal text-ink-muted">
            {" "}
            · {hm(s.from)}–{hm(s.to)}, {s.duration} min
          </span>
        </p>

        {result.hits.length === 0 && (
          <div className={`${card} mb-3 p-4`}>
            <p className="mb-3">
              In diesem Zeitfenster ist kein Platz für {s.duration} Minuten frei.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={quiet}
                onClick={() =>
                  update({ from: Math.max(360, s.from - 60), to: Math.min(1440, s.to + 60) })
                }
              >
                Fenster um je 1 h erweitern
              </button>
              {s.duration > 60 && (
                <button type="button" className={quiet} onClick={() => update({ duration: 60 })}>
                  Nur 1 h spielen
                </button>
              )}
              {next && (
                <button type="button" className={quiet} onClick={() => update({ day: next })}>
                  Nächsten Tag zeigen
                </button>
              )}
            </div>
          </div>
        )}

        {result.hits.map((hit) => (
          <VenueCard key={hit.venue.id} hit={hit} search={s} onPick={ask ? setPicked : undefined} />
        ))}

        {result.bookedOut.length > 0 && (
          <p className="mb-3 text-sm text-ink-muted">
            <b className="font-semibold text-ink">Ausgebucht:</b>{" "}
            {result.bookedOut.map((v) => v.name).join(", ")}
          </p>
        )}
        {result.notYet.length > 0 && (
          <p className="mb-3 text-sm text-ink-muted">
            <b className="font-semibold text-ink">Noch nicht buchbar:</b>{" "}
            {result.notYet.map((v) => v.name).join(", ")}, dort kann man nur wenige Tage im Voraus
            buchen.
          </p>
        )}
        {result.failed.map((v) => (
          <p
            key={v.id}
            className="mb-2 rounded-xl border border-warning-border bg-warning-subtle px-3 py-2 text-sm text-warning-text"
          >
            {v.name}: gerade nicht abrufbar.{" "}
            <a className="underline" href={bookingLink(v, s.day)} target="_blank" rel="noopener">
              Direkt nachsehen
            </a>
          </p>
        ))}
      </main>
      {picked && ask?.(picked, () => setPicked(null))}

      <footer className="mt-6 border-t border-line pt-4 pb-10 text-xs text-ink-muted [&>p]:mb-1.5">
        <p>
          Die Daten kommen von den öffentlichen Buchungsseiten der Anlagen und werden alle 30
          Minuten abgefragt, mit „Aktualisieren“ auch sofort, höchstens alle 5 Minuten. Bis du
          buchst, kann ein Platz schon weg sein. Gebucht wird direkt bei der Anlage, dafür brauchst
          du dort ein Konto.
        </p>
        <p>
          Kein offizielles Angebot der Anlagen. Preise gelten für den ganzen Platz (bis 4 Spieler)
          und die gewählte Spieldauer, laut Buchungsseite oder Preisliste der Anlage, ohne Gewähr.
          Mitglieder- und Abo-Tarife können abweichen.
        </p>
      </footer>
    </>
  );
}

function Segments<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-ink-muted">
      <span>{label}</span>
      <div
        role="group"
        aria-label={label}
        className="inline-flex overflow-hidden rounded-xl border border-line bg-card"
      >
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={v === value}
            onClick={() => onChange(v)}
            className={`h-11 border-l border-line px-3 text-[15px] first:border-l-0 pointer-coarse:h-(--size-control-touch) ${
              v === value ? "bg-accent text-accent-ink" : "text-ink hover:bg-hover"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const chip =
  "inline-flex min-w-14 flex-col items-center rounded-lg bg-accent-subtle px-2.5 py-1 font-mono text-[15px] leading-tight font-semibold text-accent-text tabular-nums hover:bg-accent-subtle-hover pointer-coarse:min-h-(--size-control-touch) pointer-coarse:justify-center";

function Badge({ area }: { area: string | null | undefined }) {
  if (!area) return null;
  const tone =
    area === "freiluft"
      ? "bg-warning-subtle text-warning-text"
      : "bg-accent-subtle text-accent-text";
  return (
    <span
      className={`ml-1.5 inline-block rounded-md px-1.5 align-[0.12em] text-[11px] font-semibold ${tone}`}
    >
      {AREA_LABEL[area] ?? area}
    </span>
  );
}

function VenueCard({
  hit,
  search: s,
  onPick,
}: {
  hit: Hit;
  search: Search;
  onPick?: (slot: Slot) => void;
}) {
  const { venue: v } = hit;
  const href = bookingLink(v, s.day);
  const map = mapLink(v);
  return (
    <article className={`${card} mb-3 px-4 py-3.5`}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">
            {v.name}
            <Badge area={hit.area} />
          </h2>
          <div className="text-sm text-ink-muted">
            {v.place}
            {map && (
              <>
                {" · "}
                <a
                  className="hover:underline"
                  href={map}
                  target="_blank"
                  rel="noopener"
                  title={v.address}
                >
                  Karte
                </a>
              </>
            )}
          </div>
        </div>
        <a
          className={`${link} shrink-0 text-sm whitespace-nowrap`}
          href={href}
          target="_blank"
          rel="noopener"
        >
          Zur Buchung ↗
        </a>
      </div>
      {hit.courts.map(({ court, options }) => (
        <div
          key={court.name}
          className="mt-2.5 grid grid-cols-1 gap-1.5 border-t border-dashed border-line pt-2.5 sm:grid-cols-[minmax(96px,150px)_1fr] sm:gap-3"
        >
          <div className="pt-1 text-sm break-words text-ink-muted">
            {court.name}
            {hit.mixed && (
              <>
                <br />
                <Badge area={court.area} />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const title = `${court.name} · ${hm(o.start)}–${hm(o.start + s.duration)}`;
              const face = (
                <>
                  {hm(o.start)}
                  {o.priceCents != null && (
                    <small className="text-[11px] font-normal opacity-80">
                      {euro(o.priceCents)}
                    </small>
                  )}
                </>
              );
              return onPick ? (
                <button
                  key={o.start}
                  type="button"
                  title={title}
                  className={chip}
                  onClick={() =>
                    onPick({
                      venueId: v.id,
                      venueName: v.name,
                      court: court.name,
                      day: s.day,
                      start: o.start,
                      minutes: s.duration,
                      href,
                    })
                  }
                >
                  {face}
                </button>
              ) : (
                <a
                  key={o.start}
                  href={href}
                  target="_blank"
                  rel="noopener"
                  title={title}
                  className={chip}
                >
                  {face}
                </a>
              );
            })}
          </div>
        </div>
      ))}
      {v.platform === "eversports" && (
        <p className="mt-2 text-sm text-ink-muted">Startzeiten nur zur vollen Stunde.</p>
      )}
      {v.priceNote && <p className="mt-2 text-sm text-ink-muted">{v.priceNote}</p>}
    </article>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Lädt">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="mb-3 h-28 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      ))}
    </div>
  );
}

function Failed({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className={`${card} mt-4 p-4`} role="alert">
      <p className="mb-3">{text} Das liegt an der Verbindung oder an den Buchungsseiten.</p>
      <button type="button" className={quiet} onClick={retry}>
        Nochmal versuchen
      </button>
    </div>
  );
}
