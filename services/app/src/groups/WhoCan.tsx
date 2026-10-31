// Wer kann wann on a group's page (Seb, 2026-10-31, feedback #68): the
// next 14 days, every half hour from 6 to 24, the darker the more members
// can; four or more get a dot. It scales with the group, where a row per
// member would not. Wide, the days are rows and a hover names who can; on a
// phone the grid turns, days side by side and the time running down, and a
// tap on a day opens it in the sheet as blocks of time with their names.
// Members only (GET /groups/{id}/availability).
import { useQuery } from "@tanstack/react-query";
import { useState, type MouseEvent } from "react";
import { Link } from "react-router";
import { api, call, type AvailabilityDay } from "../api/client";
import { Sheet } from "@burgstaller/web/sheet";
import { card, link, quiet } from "../ui";

const FIRST = 6 * 60;
const STEP = 30;
const SLOTS = (24 * 60 - FIRST) / STEP;
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const FOUR = 4;

type Member = { email: string; name: string; days: AvailabilityDay[] };

/** "Mi 4.11." */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

const weekend = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

/** 1110 is "18:30". */
export function clock(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

const shown = (m: { email: string; name: string }) => m.name || m.email.split("@")[0]!;

/** Each day from from to to, both included, as YYYY-MM-DD. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) return out;
    out.push(day);
  }
}

export type Day = {
  day: string;
  /** Who can, per half hour from 6:00. */
  can: string[][];
  declined: string[];
  open: string[];
};

/** The window as days, each with who can in every half hour. */
export function overlay(from: string, to: string, members: Member[]): Day[] {
  return daysBetween(from, to).map((day) => {
    const out: Day = { day, can: Array.from({ length: SLOTS }, () => []), declined: [], open: [] };
    for (const m of members) {
      const d = m.days.find((x) => x.day === day);
      if (!d) out.open.push(shown(m));
      else if (d.declined) out.declined.push(shown(m));
      for (const s of d?.spans ?? [])
        for (let t = s.from; t < s.to; t += STEP) out.can[(t - FIRST) / STEP]?.push(shown(m));
    }
    return out;
  });
}

/** One day as blocks of time where the same people can. */
export function blocks(d: Day): { from: number; to: number; who: string[] }[] {
  const out: { from: number; to: number; who: string[] }[] = [];
  d.can.forEach((who, i) => {
    const from = FIRST + i * STEP;
    const last = out[out.length - 1];
    if (last && last.to === from && last.who.join() === who.join()) last.to = from + STEP;
    else out.push({ from, to: from + STEP, who });
  });
  return out.filter((b) => b.who.length > 0);
}

/** The cell's colour: the accent, stronger the more can. */
function shade(n: number): string | undefined {
  if (n === 0) return undefined;
  const pct = n < FOUR ? [0, 22, 38, 54][n]! : Math.min(100, 72 + (n - FOUR) * 7);
  return `color-mix(in srgb, var(--color-accent) ${pct}%, var(--color-sunken))`;
}

function Cell({ n, onEnter }: { n: number; onEnter?: (e: MouseEvent<HTMLElement>) => void }) {
  return (
    <span
      className="relative block rounded-[2px] bg-sunken"
      style={{ background: shade(n) }}
      onMouseEnter={onEnter}
    >
      {n >= FOUR && (
        <span className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-card" />
      )}
    </span>
  );
}

type Hover = { d: Day; i: number; x: number; y: number };

export function WhoCan({ group }: { group: number }) {
  const q = useQuery({
    queryKey: ["group-availability", group],
    queryFn: () =>
      call(
        api.GET("/api/v1/groups/{groupId}/availability", {
          params: { path: { groupId: group } },
        }),
      ),
    retry: false,
  });
  const [hover, setHover] = useState<Hover | null>(null);
  const [open, setOpen] = useState<Day | null>(null);

  const days = q.data ? overlay(q.data.from, q.data.to, q.data.members) : [];
  const total = q.data?.members.length ?? 0;
  const nobody = days.every((d) => d.can.every((w) => w.length === 0));
  const best = (d: Day) => Math.max(...d.can.map((w) => w.length));
  const enter = (d: Day, i: number) => (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.closest("[data-grid]")!.getBoundingClientRect();
    const cell = e.currentTarget.getBoundingClientRect();
    setHover({ d, i, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top });
  };

  return (
    <section className="mb-6" aria-labelledby="who-can">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="who-can" className="font-semibold">
          Wer kann wann
        </h2>
        <span className="text-sm text-ink-muted">
          die nächsten 14 Tage<span className="md:hidden"> · Tag antippen</span>
        </span>
      </div>
      {q.isPending && (
        <div
          aria-busy="true"
          aria-label="Lädt"
          className="h-40 animate-skeleton rounded-2xl border border-line bg-sunken"
        />
      )}
      {q.isError && (
        <p className="text-sm text-ink-muted" role="alert">
          Wer wann kann, konnte nicht geladen werden.
        </p>
      )}
      {q.data && nobody && (
        <p className="text-sm text-ink-muted">
          Noch hat niemand Zeiten eingetragen.{" "}
          <Link to="/availability" className={link}>
            Wann kann ich?
          </Link>
        </p>
      )}
      {q.data && !nobody && (
        <>
          {/* Wide: a day per row, hover for who. */}
          <div
            className={`${card} relative p-3 max-md:hidden`}
            data-grid
            onMouseLeave={() => setHover(null)}
          >
            <div className="mb-1 grid grid-cols-[4.5rem_1fr] gap-3 font-mono text-[10px] text-ink-faint">
              <span />
              <span className="flex justify-between">
                {[6, 9, 12, 15, 18, 21, 24].map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </span>
            </div>
            <div className="space-y-[3px]">
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className="grid w-full grid-cols-[4.5rem_1fr] items-center gap-3 rounded-sm text-left hover:bg-hover"
                  aria-label={`${dayLabel(d.day)}: bis zu ${best(d)} von ${total}`}
                  onClick={() => setOpen(d)}
                >
                  <span
                    className={`font-mono text-xs ${weekend(d.day) ? "text-ink-muted" : "text-ink-secondary"}`}
                  >
                    {dayLabel(d.day)}
                  </span>
                  <span className="grid h-[18px] grid-cols-[repeat(36,minmax(0,1fr))] gap-px">
                    {d.can.map((w, i) => (
                      <Cell key={i} n={w.length} onEnter={enter(d, i)} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {hover && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-3 py-2 text-[13px] text-ink-inverse shadow-lg"
                style={{ left: hover.x, top: hover.y - 6 }}
              >
                <div className="font-semibold">
                  {dayLabel(hover.d.day)} · {clock(FIRST + hover.i * STEP)}–
                  {clock(FIRST + (hover.i + 1) * STEP)}
                </div>
                <div>
                  {hover.d.can[hover.i]!.length} von {total}
                  {hover.d.can[hover.i]!.length > 0 && `: ${hover.d.can[hover.i]!.join(", ")}`}
                </div>
              </div>
            )}
          </div>

          {/* Phone: the days side by side, the time running down. */}
          <div className={`${card} p-2.5 md:hidden`}>
            <div className="mb-1 grid grid-cols-[1.25rem_repeat(14,minmax(0,1fr))] gap-0.5 text-center font-mono text-[10px] leading-tight text-ink-muted">
              <span />
              {days.map((d) => (
                <span key={d.day}>
                  {dayLabel(d.day).slice(0, 2)}
                  <b className="block font-medium text-ink-secondary">
                    {Number(d.day.slice(8, 10))}
                  </b>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[1.25rem_repeat(14,minmax(0,1fr))] gap-0.5">
              <span className="relative font-mono text-[9.5px] text-ink-faint">
                {[6, 9, 12, 15, 18, 21].map((h) => (
                  <span
                    key={h}
                    className="absolute right-0.5"
                    style={{ top: `${((h - 6) / 18) * 100}%` }}
                  >
                    {h}
                  </span>
                ))}
              </span>
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className="grid grid-rows-[repeat(36,9px)] gap-px rounded-sm"
                  aria-label={`${dayLabel(d.day)}: bis zu ${best(d)} von ${total}`}
                  onClick={() => setOpen(d)}
                >
                  {d.can.map((w, i) => (
                    <Cell key={i} n={w.length} />
                  ))}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
            Können:
            {[1, 2, 3, FOUR].map((n) => (
              <span key={n} className="inline-flex items-center gap-1 pl-1.5">
                <span
                  className="inline-block h-2.5 w-3.5 rounded-[2px]"
                  style={{ background: shade(n) }}
                />
                {n === FOUR ? "4 und mehr" : n}
              </span>
            ))}
          </div>
        </>
      )}
      {open && (
        <Sheet label={dayLabel(open.day)} wide="float" onClose={() => setOpen(null)}>
          <DayBlocks d={open} total={total} />
          <button type="button" className={`${quiet} mt-3 w-full`} onClick={() => setOpen(null)}>
            Schließen
          </button>
        </Sheet>
      )}
    </section>
  );
}

function DayBlocks({ d, total }: { d: Day; total: number }) {
  const list = blocks(d);
  const most = Math.max(0, ...list.map((b) => b.who.length));
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{dayLabel(d.day)}</h3>
        <span className="text-sm text-ink-muted">
          bis zu {most} von {total}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">An diesem Tag hat noch niemand Zeit.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {list.map((b) => (
            <li
              key={b.from}
              className={`grid grid-cols-[6.5rem_1.75rem_1fr] items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                b.who.length >= FOUR
                  ? "bg-accent-subtle ring-1 ring-accent-border ring-inset"
                  : "bg-sunken"
              }`}
            >
              <span className="font-mono text-xs text-ink-secondary">
                {clock(b.from)}–{clock(b.to)}
              </span>
              <span
                className={`rounded-md text-center font-mono text-xs font-semibold ${b.who.length >= 3 ? "text-accent-ink" : "text-ink"}`}
                style={{ background: shade(b.who.length) }}
              >
                {b.who.length}
              </span>
              <span className="text-ink-secondary">{b.who.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      {most >= FOUR && (
        <p className="mt-2 text-sm text-ink-muted">
          Ab vier passt es, wenn ein Platz frei ist. Freie Plätze stehen unter „Passt für vier“.
        </p>
      )}
      <div className="mt-3 space-y-1 text-sm text-ink-muted">
        {d.declined.length > 0 && (
          <p>
            <b className="font-semibold text-ink-secondary">Passt nicht:</b> {d.declined.join(", ")}
          </p>
        )}
        {d.open.length > 0 && (
          <p>
            <b className="font-semibold text-warning-text">Noch offen:</b> {d.open.join(", ")}
          </p>
        )}
      </div>
    </>
  );
}
