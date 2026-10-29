// When can I? (docs/design/availability.md): the next 14 days on a line from
// 6 to 24, a day opens to say when, in half hours and as many spans as one
// likes, or that it does not suit ("Passt nicht"). A day with nothing is
// still open: it means "can't" too, but the others may ask. What someone
// usually has on a weekday is kept, and fills open days on request. Below,
// the venues they drive to.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  api,
  ApiError,
  call,
  useWriteKey,
  type Availability as Mine,
  type AvailabilityDay,
  type Span,
  type Template,
} from "../api/client";
import { Link } from "react-router";
import { card, danger, field, link, pressed, primary, quiet } from "../ui";
import {
  clock,
  dayLabel,
  daysBetween,
  FIRST,
  GRID,
  LAST,
  merge,
  QUICK,
  spansText,
  weekday,
  WEEKDAYS_LONG,
} from "./time";

const KEY = ["availability"];

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === "invalid-spans") return "Die Zeiten passen nicht: halbe Stunden von 6 bis 24.";
    if (e.kind === "outside-window") return "Nur heute und die nächsten 13 Tage.";
    if (e.kind === "unknown-venue") return "Diese Anlage gibt es nicht mehr.";
  }
  return "Das hat nicht geklappt. Versuch es nochmal.";
}

async function put(
  day: string,
  spans: Span[],
  declined: boolean,
  key: string,
): Promise<AvailabilityDay> {
  return call(
    api.PUT("/api/v1/availability/days/{day}", {
      params: { path: { day }, header: { "Idempotency-Key": key } },
      body: { spans, declined },
    }),
  );
}

/** The cache with one day replaced. */
function withDay(m: Mine, saved: AvailabilityDay): Mine {
  const days = m.days.filter((d) => d.day !== saved.day);
  if (saved.spans.length > 0 || saved.declined) days.push(saved);
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { ...m, days };
}

/** What a row says of its day. */
function dayText(d: AvailabilityDay | undefined): string {
  if (d?.declined) return "passt nicht";
  return (d && spansText(d.spans)) || "noch offen";
}

export function Availability() {
  const client = useQueryClient();
  const mine = useQuery({
    queryKey: KEY,
    queryFn: () => call(api.GET("/api/v1/availability")),
    retry: false,
  });
  const [open, setOpen] = useState<string | null>(null);

  const fillKey = useWriteKey();
  const fill = useMutation({
    mutationFn: async (todo: { day: string; spans: Span[] }[]) => {
      for (const t of todo) {
        const saved = await put(t.day, t.spans, false, fillKey(t));
        client.setQueryData<Mine>(KEY, (m) => m && withDay(m, saved));
      }
    },
  });

  return (
    <main>
      <h1 className="mt-2 mb-1 text-2xl font-semibold">Wann kannst du?</h1>
      <p className="mb-4 text-ink-muted">
        Für die nächsten zwei Wochen. Tipp auf einen Tag und sag, von wann bis wann, oder dass er
        nicht passt. Ein offener Tag zählt wie „kann nicht“, aber die anderen fragen dich vielleicht
        noch.{" "}
        <Link to="/help#zeiten" className={link}>
          So geht’s
        </Link>
      </p>
      {mine.isPending && (
        <div aria-busy="true" aria-label="Lädt">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="mb-2 h-12 animate-skeleton rounded-2xl border border-line bg-sunken"
            />
          ))}
        </div>
      )}
      {mine.isError && (
        <div className={`${card} p-4`} role="alert">
          <p className="mb-3">Deine Zeiten konnten nicht geladen werden.</p>
          <button type="button" className={quiet} onClick={() => void mine.refetch()}>
            Nochmal versuchen
          </button>
        </div>
      )}
      {mine.data && (
        <>
          <Fill
            mine={mine.data}
            busy={fill.isPending}
            failed={fill.isError}
            onFill={(todo) => fill.mutate(todo)}
          />
          <Open mine={mine.data} />
          <div className="mb-1 flex pl-24 text-xs text-ink-muted" aria-hidden="true">
            {[6, 12, 18].map((h) => (
              <span key={h} className="flex-1">
                {h}
              </span>
            ))}
            <span>24</span>
          </div>
          <ul className={`${card} divide-y divide-line`}>
            {daysBetween(mine.data.from, mine.data.to).map((day) => {
              const said = mine.data.days.find((d) => d.day === day);
              const spans = said?.spans ?? [];
              const declined = said?.declined ?? false;
              return (
                <li key={day}>
                  {open === day ? (
                    <DayEditor
                      day={day}
                      spans={spans}
                      declined={declined}
                      usual={
                        mine.data.templates.find((t) => t.weekday === weekday(day))?.spans ?? []
                      }
                      templates={mine.data.templates}
                      onClose={() => setOpen(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                      aria-label={`${dayLabel(day)}: ${dayText(said)}`}
                      onClick={() => setOpen(day)}
                    >
                      <span className="w-20 shrink-0 text-sm font-semibold">{dayLabel(day)}</span>
                      <span className="min-w-0 flex-1">
                        <Line spans={spans} declined={declined} />
                        <span
                          className={`mt-1 block truncate text-xs ${declined ? "font-semibold text-ink-secondary" : spans.length > 0 ? "text-ink-muted" : "text-warning-text"}`}
                        >
                          {declined ? "Passt nicht" : spansText(spans) || "offen · antippen"}
                        </span>
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Venues chosen={mine.data.venues} />
        </>
      )}
    </main>
  );
}

/** How many days are still open, so one sees what is left to think about. */
function Open({ mine }: { mine: Mine }) {
  const all = daysBetween(mine.from, mine.to);
  const open = all.filter((day) => !mine.days.some((d) => d.day === day)).length;
  return (
    <p className="mb-3 text-sm text-ink-muted">
      {open === 0 ? "Alle Tage sind eingetragen." : `Noch offen: ${open} von ${all.length} Tagen`}
    </p>
  );
}

/** The day from 6 to 24, with the spans filled in; hatched when it does
 * not suit. */
function Line({ spans, declined }: { spans: Span[]; declined: boolean }) {
  const pct = (m: number) => `${((m - FIRST) / (LAST - FIRST)) * 100}%`;
  if (declined)
    return (
      <span
        className="block h-3 rounded-full bg-sunken"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--color-line-strong) 0 2px, transparent 2px 7px)",
        }}
        aria-hidden="true"
      />
    );
  return (
    <span className="relative block h-3 rounded-full bg-sunken" aria-hidden="true">
      {spans.map((s) => (
        <span
          key={s.from}
          className="absolute inset-y-0 rounded-full bg-accent"
          style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }}
        />
      ))}
    </span>
  );
}

/** Empty days that have a usual time, filled at once. */
function Fill({
  mine,
  busy,
  failed,
  onFill,
}: {
  mine: Mine;
  busy: boolean;
  failed: boolean;
  onFill: (todo: { day: string; spans: Span[] }[]) => void;
}) {
  // A day that does not suit is not empty: it stays as it is.
  const todo = daysBetween(mine.from, mine.to)
    .filter((day) => !mine.days.some((d) => d.day === day))
    .map((day) => ({
      day,
      spans: mine.templates.find((t) => t.weekday === weekday(day))?.spans ?? [],
    }))
    .filter((t) => t.spans.length > 0);
  if (todo.length === 0 && !failed) return null;
  return (
    <div className="mb-4">
      {todo.length > 0 && (
        <button
          type="button"
          className={quiet}
          disabled={busy}
          aria-busy={busy}
          onClick={() => onFill(todo)}
        >
          {busy
            ? "Trägt ein …"
            : `${todo.length} leere ${todo.length === 1 ? "Tag" : "Tage"} wie meistens füllen`}
        </button>
      )}
      {failed && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          Nicht alle Tage wurden gefüllt. Versuch es nochmal.
        </p>
      )}
    </div>
  );
}

function DayEditor({
  day,
  spans,
  declined,
  usual,
  templates,
  onClose,
}: {
  day: string;
  spans: Span[];
  declined: boolean;
  usual: Span[];
  templates: Template[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Span[]>(spans);
  const [remember, setRemember] = useState(false);
  const dayKey = useWriteKey();
  const templateKey = useWriteKey();
  const save = useMutation({
    mutationFn: async ({ next, no }: { next: Span[]; no: boolean }) => {
      const saved = await put(day, next, no, dayKey({ day, next, no }));
      client.setQueryData<Mine>(KEY, (m) => m && withDay(m, saved));
      if (remember) {
        const wd = weekday(day);
        const body = {
          templates: [
            ...templates.filter((t) => t.weekday !== wd),
            ...(saved.spans.length > 0 ? [{ weekday: wd, spans: saved.spans }] : []),
          ],
        };
        const out = await call(
          api.PUT("/api/v1/availability/templates", {
            params: { header: { "Idempotency-Key": templateKey(body) } },
            body,
          }),
        );
        client.setQueryData<Mine>(KEY, (m) => m && { ...m, templates: out.templates });
      }
    },
    onSuccess: onClose,
  });
  const set = (i: number, s: Span) => setDraft(draft.map((d, j) => (j === i ? s : d)));
  const wdName = WEEKDAYS_LONG[weekday(day) - 1];

  return (
    <div className="px-4 py-3">
      <h2 className="mb-2 font-semibold">{dayLabel(day)}</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q.label}
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(false)}`}
            onClick={() => setDraft(merge([...draft, q.span]))}
          >
            {q.label}
          </button>
        ))}
        {usual.length > 0 && spansText(usual) !== spansText(merge(draft)) && (
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(false)}`}
            onClick={() => setDraft(usual)}
          >
            Wie meistens: {spansText(usual)}
          </button>
        )}
      </div>
      {draft.length === 0 && (
        <p className="mb-3 text-sm text-ink-muted">
          {declined
            ? "Passt nicht: an diesem Tag spielst du nicht."
            : "Noch offen: zählt wie „kann nicht“, aber die anderen fragen dich vielleicht."}
        </p>
      )}
      <ul className="mb-3 space-y-2">
        {draft.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`from-${i}`}>
              Von
            </label>
            <select
              id={`from-${i}`}
              className={field}
              value={s.from}
              onChange={(e) => {
                const from = Number(e.target.value);
                set(i, { from, to: Math.max(s.to, Math.min(from + 60, LAST)) });
              }}
            >
              {GRID.filter((m) => m < LAST).map((m) => (
                <option key={m} value={m}>
                  {clock(m)}
                </option>
              ))}
            </select>
            <span aria-hidden="true">bis</span>
            <label className="sr-only" htmlFor={`to-${i}`}>
              Bis
            </label>
            <select
              id={`to-${i}`}
              className={field}
              value={s.to}
              onChange={(e) => set(i, { from: s.from, to: Number(e.target.value) })}
            >
              {GRID.filter((m) => m > s.from).map((m) => (
                <option key={m} value={m}>
                  {clock(m)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${link} px-2 text-sm`}
              aria-label={`${clock(s.from)}–${clock(s.to)} weg`}
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
            >
              Weg
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`${link} mb-3 text-sm`}
        onClick={() => {
          const after = draft.length
            ? Math.min(draft[draft.length - 1]!.to + 60, LAST - 60)
            : 18 * 60;
          setDraft([...draft, { from: after, to: after + 60 }]);
        }}
      >
        + Noch eine Zeit
      </button>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        So ist es meistens am {wdName}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={save.isPending}
          aria-busy={save.isPending}
          // With no times, a day that did not suit still does not.
          onClick={() => save.mutate({ next: merge(draft), no: declined && draft.length === 0 })}
        >
          {save.isPending ? "Speichert …" : "Speichern"}
        </button>
        {!declined && (
          <button
            type="button"
            className={danger}
            disabled={save.isPending}
            onClick={() => save.mutate({ next: [], no: true })}
          >
            Passt nicht
          </button>
        )}
        {(declined || spans.length > 0) && (
          <button
            type="button"
            className={quiet}
            disabled={save.isPending}
            onClick={() => save.mutate({ next: [], no: false })}
          >
            Wieder offen
          </button>
        )}
        <button type="button" className={quiet} onClick={onClose}>
          Abbrechen
        </button>
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(save.error)}
        </p>
      )}
    </div>
  );
}

/** Where they drive to; none chosen means every venue. */
function Venues({ chosen }: { chosen: string[] }) {
  const client = useQueryClient();
  const venues = useQuery({
    queryKey: ["venues"],
    queryFn: async () => {
      try {
        const snap = await call(api.GET("/api/v1/slots"));
        return snap.venues.map((v) => ({ id: v.id, name: v.name, place: v.place }));
      } catch (e) {
        if (e instanceof ApiError && e.kind === "no-snapshot") return [];
        throw e;
      }
    },
    retry: false,
  });
  const key = useWriteKey();
  const save = useMutation({
    mutationFn: (next: string[]) =>
      call(
        api.PUT("/api/v1/availability/venues", {
          params: { header: { "Idempotency-Key": key(next) } },
          body: { venues: next },
        }),
      ),
    onSuccess: (out) => client.setQueryData<Mine>(KEY, (m) => m && { ...m, venues: out.venues }),
  });
  if (!venues.data || venues.data.length === 0) return null;
  const toggle = (id: string) =>
    save.mutate(chosen.includes(id) ? chosen.filter((v) => v !== id) : [...chosen, id]);

  return (
    <section className="mt-6">
      <h2 className="mb-1 font-semibold">Wohin fährst du?</h2>
      <p className="mb-2 text-sm text-ink-muted">
        {chosen.length === 0 ? "Überall hin. Tipp an, wenn nur manche passen." : "Nur zu diesen:"}
      </p>
      <div className="flex flex-wrap gap-2">
        {venues.data.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={chosen.includes(v.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${pressed(chosen.includes(v.id))}`}
            disabled={save.isPending}
            onClick={() => toggle(v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {errorText(save.error)}
        </p>
      )}
    </section>
  );
}
